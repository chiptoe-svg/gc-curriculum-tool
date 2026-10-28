#!/usr/bin/env tsx
/**
 * One-time: relabel competencies backed by both the instructor and a course
 * file (owner, 2026-10-27). Synthesis used to label a competency citing both
 * an instructor turn and a material chunk 'inferred' — the same label as no
 * evidence — so the review screen called it a guess and the evidence ladder
 * ranked it 'claimed'. New profiles get 'both' (deriveSourceFlag).
 *
 * For every snapshot and draft profile, sets source 'both' on each competency
 * stored as 'inferred' whose stored citations include at least one instructor
 * and one chunk citation. Nothing else changes: no other label, no score, no
 * citation. No model calls. Run the wiki refresh afterwards so course pages
 * pick up the new labels.
 *
 * --apply locks each row (SELECT ... FOR UPDATE) inside one transaction,
 * re-reads it, and sets only those `source` keys with jsonb_set — never a
 * whole-profile write-back, so a draft saved by the running app during the
 * run is not lost and no other value is re-serialized (adversarial review,
 * 2026-10-27).
 *
 * Usage (DATABASE_URL from .env.local; never printed):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/capture/relabel-both-sources.ts --expect-db gc_curriculum [--apply]   # default: dry run
 *
 * Exit codes: 0 ok, 1 wrong DB, 2 usage, 4 apply failed.
 */
import { eq, sql } from 'drizzle-orm';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { deriveSourceFlag } from '@/lib/ai/synthesis/source-derivation';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';

/** Pure: positions in `competencies` stored 'inferred' with mixed citations. Malformed shapes are skipped. */
export function relabelIndices(profile: unknown): number[] {
  const comps = (profile as { competencies?: unknown } | null)?.competencies;
  if (!Array.isArray(comps)) return [];
  const out: number[] = [];
  comps.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const { source, citations } = c as { source?: unknown; citations?: unknown };
    if (source !== 'inferred' || !Array.isArray(citations)) return;
    const cites = citations.filter((x): x is { type: string } => !!x && typeof x === 'object' && typeof (x as { type?: unknown }).type === 'string');
    if (deriveSourceFlag(cites as never) === 'both') out.push(i);
  });
  return out;
}

/** Pure: returns a new profile with mixed-citation 'inferred' competencies set to 'both'. */
export function relabelProfile(profile: CaptureProfile): { profile: CaptureProfile; changed: number } {
  const idx = new Set(relabelIndices(profile));
  if (!idx.size) return { profile, changed: 0 };
  const competencies = profile.competencies.map((c, i) => (idx.has(i) ? { ...c, source: 'both' as const } : c));
  return { profile: { ...profile, competencies }, changed: idx.size };
}

/** SQL expression: `col` with competencies[i].source set to "both" for each i (nothing else touched). */
function setBothAt(col: ReturnType<typeof sql>, indices: number[]) {
  return indices.reduce((expr, i) => sql`jsonb_set(${expr}, ${`{competencies,${i},source}`}::text[], '"both"'::jsonb, false)`, col);
}

export async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) { console.error('usage: --expect-db <name> [--apply]'); return 2; }
  const { db } = await import('@/lib/db/client');
  const { courseCaptureProfiles, courseCaptureSnapshots } = await import('@/lib/db/schema');
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }
  const apply = argv.includes('--apply');

  const snapshots = await db.select({ id: courseCaptureSnapshots.id, courseCode: courseCaptureSnapshots.courseCode, createdAt: courseCaptureSnapshots.createdAt, profile: courseCaptureSnapshots.profile }).from(courseCaptureSnapshots);
  const drafts = await db.select({ courseCode: courseCaptureProfiles.courseCode, profile: courseCaptureProfiles.profile }).from(courseCaptureProfiles);

  const snapPlan = snapshots.map(s => ({ ...s, changed: relabelIndices(s.profile).length })).filter(s => s.changed);
  const draftPlan = drafts.map(d => ({ ...d, changed: relabelIndices(d.profile).length })).filter(d => d.changed);
  for (const s of snapPlan) console.log(`snapshot ${s.courseCode.padEnd(9)} ${s.createdAt.toISOString().slice(0, 10)} ${s.id.slice(0, 8)}  ${s.changed} competenc${s.changed === 1 ? 'y' : 'ies'} inferred -> both`);
  for (const d of draftPlan) console.log(`draft    ${d.courseCode.padEnd(9)}                     ${d.changed} competenc${d.changed === 1 ? 'y' : 'ies'} inferred -> both`);
  const total = [...snapPlan, ...draftPlan].reduce((n, x) => n + x.changed, 0);

  if (!apply) {
    console.log(`DRY RUN: would relabel ${total} competencies in ${snapPlan.length} snapshots and ${draftPlan.length} drafts (nothing written).`);
    return 0;
  }
  let done = 0;
  try {
    await db.transaction(async tx => {
      // Lock, re-read and patch each planned row; the plan above is only a preview.
      for (const s of snapPlan) {
        const [row] = await tx.select({ profile: courseCaptureSnapshots.profile }).from(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.id, s.id)).for('update');
        const idx = relabelIndices(row?.profile);
        if (!idx.length) continue;
        await tx.update(courseCaptureSnapshots).set({ profile: setBothAt(sql`${courseCaptureSnapshots.profile}`, idx) as never }).where(eq(courseCaptureSnapshots.id, s.id));
        done += idx.length;
      }
      for (const d of draftPlan) {
        const [row] = await tx.select({ profile: courseCaptureProfiles.profile }).from(courseCaptureProfiles).where(eq(courseCaptureProfiles.courseCode, d.courseCode)).for('update');
        const idx = relabelIndices(row?.profile);
        if (!idx.length) continue;
        await tx.update(courseCaptureProfiles).set({ profile: setBothAt(sql`${courseCaptureProfiles.profile}`, idx) as never }).where(eq(courseCaptureProfiles.courseCode, d.courseCode));
        done += idx.length;
      }
    });
  } catch (err) { console.error(formatDbError(err)); return 4; }
  console.log(`relabeled ${done} competencies in ${snapPlan.length} snapshots and ${draftPlan.length} drafts. Refresh the wiki so course pages pick them up.`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
