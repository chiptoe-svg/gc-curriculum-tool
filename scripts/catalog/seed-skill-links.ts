/**
 * Seed skill -> competency links (spec docs/superpowers/specs/2026-11-15-skill-competency-links-design.md).
 *
 *   pnpm tsx scripts/catalog/seed-skill-links.ts --expect-db <database name> [--apply] [--floor 0.45] [--top 3]
 *
 * For every non-retired capture snapshot, each statement in profile.competencies becomes a skill. Two kinds of
 * proposed link are added (status 'proposed'; nothing existing is changed or removed; re-running adds only what
 * is missing):
 *   1. 'scoring'   — where the old catalog scoring (snapshot_competency_coverage) matched this statement to a
 *                    competency at a level above 0.
 *   2. 'embedding' — the statement's nearest competency cards by cosine similarity (campus Qwen embeddings,
 *                    no cost), top N at or above the floor.
 * Dry run (default) embeds nothing and writes nothing; it reports counts and the similarity spread so the floor
 * can be chosen. --apply embeds missing statements and cards (free campus model) and inserts the links.
 */
import { sql } from 'drizzle-orm';
import { loadAppEnv, isMainModule, argValue } from './catalog-source';

loadAppEnv();

type Snap = { id: string; statements: string[] };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function main(): Promise<number> {
  const { db } = await import('@/lib/db/client');
  const { embedMissing, readVectors, listActiveBundles, readConfirmedCards } = await import('@/lib/db/bundle-queries');
  const { cardEmbedText, textHash } = await import('@/lib/catalog/bundles');
  const { normalizeStatement } = await import('@/lib/catalog/project-trail');
  const { embedBatch, DEFAULT_EMBEDDING_MODEL } = await import('@/lib/ai/embeddings');
  const { skillCompetencyLinks } = await import('@/lib/db/schema');

  const expect = argValue('--expect-db');
  const apply = process.argv.includes('--apply');
  const floor = Number(argValue('--floor') ?? '0.45');
  const top = Number(argValue('--top') ?? '3');
  if (!expect) { console.error('usage: --expect-db <database name> [--apply] [--floor 0.45] [--top 3]'); return 2; }
  const current = ((await db.execute(sql`SELECT current_database() AS d`)).rows[0] as { d: string }).d;
  if (current !== expect) { console.error(`refusing: connected to ${current}, expected ${expect}`); return 2; }

  const ref = (s: string) => textHash(normalizeStatement(s));
  const snaps: Snap[] = ((await db.execute(sql`
    SELECT id, profile FROM course_capture_snapshots WHERE retired_at IS NULL`)).rows as Array<{ id: string; profile: { competencies?: Array<{ statement?: string }> } | null }>)
    .map(r => ({ id: r.id, statements: [...new Set((r.profile?.competencies ?? []).map(c => c.statement?.trim() ?? '').filter(Boolean))] }));
  const skills = snaps.flatMap(s => s.statements.map(st => ({ snapshotId: s.id, statement: st, skillRef: ref(st) })));

  // 1. The old scoring's matches.
  const cov = (await db.execute(sql`
    SELECT snapshot_id, competency_id, matched_competency FROM snapshot_competency_coverage
    WHERE matched_competency IS NOT NULL AND greatest(coalesce(k_depth,0), coalesce(u_depth,0), coalesce(d_depth,0)) > 0`)).rows as Array<{ snapshot_id: string; competency_id: string; matched_competency: string }>;
  const bySnapStmt = new Map(skills.map(s => [`${s.snapshotId}|${s.statement}`, s]));
  const links = new Map<string, typeof skillCompetencyLinks.$inferInsert>();
  for (const c of cov) {
    const s = bySnapStmt.get(`${c.snapshot_id}|${c.matched_competency.trim()}`);
    if (!s) continue;
    links.set(`${s.snapshotId}|${s.skillRef}|${c.competency_id}`, { ...s, competencyId: c.competency_id, source: 'scoring', status: 'proposed' });
  }
  const scoring = links.size;

  // 2. Embedding proposals.
  const bundles = await listActiveBundles();
  const cards = await readConfirmedCards();
  const cardItems = bundles.filter(b => cards.has(b.id)).map(b => ({ kind: 'bundle_card' as const, ref: b.id, text: cardEmbedText(b, cards.get(b.id)!) }));
  const uniqueSkills = [...new Map(skills.map(s => [s.skillRef, { kind: 'course_skill' as const, ref: s.skillRef, text: s.statement }])).values()];
  if (apply) {
    const r = await embedMissing(db, [...cardItems, ...uniqueSkills], DEFAULT_EMBEDDING_MODEL, texts => embedBatch(texts));
    console.log(`embeddings: ${r.cached} cached, ${r.embedded} newly embedded (campus model, no cost)`);
  }
  const cardVecs = await readVectors(db, 'bundle_card', cardItems, DEFAULT_EMBEDDING_MODEL);
  const skillVecs = await readVectors(db, 'course_skill', uniqueSkills, DEFAULT_EMBEDDING_MODEL);
  const best: number[] = [];
  let embedded = 0;
  for (const s of skills) {
    const v = skillVecs.get(s.skillRef);
    if (!v) continue;
    const ranked = [...cardVecs.entries()].map(([id, cv]) => ({ id, sim: cosine(v, cv) })).sort((a, b) => b.sim - a.sim);
    best.push(ranked[0]?.sim ?? 0);
    for (const r of ranked.slice(0, top)) {
      if (r.sim < floor) break;
      const key = `${s.snapshotId}|${s.skillRef}|${r.id}`;
      if (links.has(key)) continue;
      links.set(key, { ...s, competencyId: r.id, source: 'embedding', status: 'proposed', similarity: Math.round(r.sim * 1000) / 1000 });
      embedded++;
    }
  }
  best.sort((a, b) => a - b);
  const q = (p: number) => best.length ? best[Math.min(best.length - 1, Math.floor(p * best.length))]!.toFixed(3) : '-';
  console.log(`snapshots ${snaps.length}, skills ${skills.length} (${uniqueSkills.length} distinct texts), cards ${cardItems.length}`);
  console.log(`skills with a vector: ${best.length}; best-match similarity p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}`);
  console.log(`links: ${scoring} from the old scoring, ${embedded} from embeddings (floor ${floor}, top ${top})`);
  const linked = new Set([...links.values()].map(l => `${l.snapshotId}|${l.skillRef}`));
  console.log(`skills with no link at all: ${skills.filter(s => !linked.has(`${s.snapshotId}|${s.skillRef}`)).length}`);
  if (!apply) { console.log('DRY RUN: nothing written.'); return 0; }
  const rows = [...links.values()];
  for (let i = 0; i < rows.length; i += 500) await db.insert(skillCompetencyLinks).values(rows.slice(i, i + 500)).onConflictDoNothing();
  console.log(`inserted up to ${rows.length} links (existing ones kept as they were)`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
