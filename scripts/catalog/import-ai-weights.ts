#!/usr/bin/env tsx
/**
 * P3 addendum 3 — import AI-drafted provisional weights (spec
 * 2026-10-21-p3-ai-draft-weights-design.md). Validates the ratings file against
 * the live target and active competency ids (every pair exactly once), then
 * writes `ai` rows and rebuilds membership in one transaction under the
 * membership lock. Dry run by default (prints the membership changes, writes
 * nothing); --apply writes. No AI calls.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/import-ai-weights.ts --file <ratings.json> --expect-db <name> [--apply]
 *
 * Exit codes: 0 ok · 1 wrong database, invalid file or failure · 2 bad args.
 */
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';
import { importAiWeights, parseAiRatings, type ParsedAiRatings } from '@/lib/db/ai-weight-queries';
import type { Executor } from '@/lib/db/bundle-queries';

async function loadFile(path: string): Promise<ParsedAiRatings> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const targets = ((await db.execute(sql`SELECT id FROM career_targets ORDER BY id`)).rows as Array<{ id: string }>).map(r => r.id);
  const competencies = ((await db.execute(sql`SELECT id FROM sub_competencies WHERE NOT retired ORDER BY id`)).rows as Array<{ id: string }>).map(r => r.id);
  return parseAiRatings(raw, { targets, competencies });
}

export async function main(argv: string[], deps: { run?: typeof importAiWeights; load?: (path: string) => Promise<ParsedAiRatings> } = {}): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const file = arg('--file');
  const expectDb = arg('--expect-db');
  if (!file || !expectDb) {
    console.error('usage: --file <ratings.json> --expect-db <name> [--apply]');
    return 2;
  }
  try {
    await assertExpectedDb(expectDb, db);
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
  const apply = argv.includes('--apply');
  let parsed: ParsedAiRatings;
  try {
    parsed = await (deps.load ?? loadFile)(file);
  } catch (err) {
    console.error(`invalid ratings file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  try {
    const report = await db.transaction(tx => (deps.run ?? importAiWeights)(tx as Executor, parsed, { apply }));
    const out = [`${apply ? 'APPLY' : 'DRY RUN'} expect-db: ${expectDb} · model ${parsed.model} · ${report.upserted} ratings`];
    if (report.changes.length) {
      out.push('Membership and band changes (refresh these wiki target pages by hand):');
      for (const c of report.changes) out.push(`  ${c.careerTargetId}: ${c.competencyId} ${c.change} (${c.from ?? '-'} -> ${c.to ?? '-'})`);
    }
    if (!apply) out.push('DRY RUN — nothing written.');
    console.log(out.join('\n'));
    return 0;
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
