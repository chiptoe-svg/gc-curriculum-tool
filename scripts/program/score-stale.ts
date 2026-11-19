#!/usr/bin/env tsx
/**
 * Score stale snapshots WITHOUT the per-snapshot wiki rebuild (owner, 2026-11-19).
 *
 * The /program button scores stale snapshots and then rebuilds the wiki once per scored snapshot;
 * each rebuild regenerates ~52 program-wide pages, so 23 snapshots meant ~230 Sol calls
 * (Oct 19, 22 snapshots: $236.59 AI spend that day). This runs the same scoring
 * (lib/program/score-stale.ts) and leaves the wiki alone; rebuild only what changed afterwards
 * with scripts/wiki/refresh-all.ts (--competency <slug>, --only targets, --course "<code>").
 *
 * Usage (DATABASE_URL and AI env set explicitly by the caller):
 *   … scripts/program/score-stale.ts --expect-db gc_curriculum            # dry run: lists what would be scored
 *   … scripts/program/score-stale.ts --expect-db gc_curriculum --apply    # paid calls, writes coverage cells
 */
import { sql } from 'drizzle-orm';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const expect = argv[argv.indexOf('--expect-db') + 1];
  if (!argv.includes('--expect-db') || !expect) { console.error('--expect-db <database name> is required'); return 2; }
  const { db } = await import('@/lib/db/client');
  const current = ((await db.execute(sql`select current_database() as d`)).rows[0] as { d: string }).d;
  if (current !== expect) { console.error(`refusing: connected to ${current}, expected ${expect}`); return 2; }

  const { listStaleSnapshots } = await import('@/lib/db/program-coverage-queries');
  const stale = await listStaleSnapshots();
  const missing = new Map<string, number>();
  for (const s of stale) for (const id of s.missingCompetencyIds) missing.set(id, (missing.get(id) ?? 0) + 1);
  console.log(`${stale.length} stale snapshot(s); missing competencies: ${[...missing].map(([id, n]) => `${id} ×${n}`).join(', ') || 'none'}`);
  if (!argv.includes('--apply')) { console.log('dry run: no model calls, no writes'); return 0; }

  const { resolveForFunction } = await import('@/lib/ai/function-settings');
  console.log('scoring model:', JSON.stringify(await resolveForFunction('program-score-coverage')));
  const { scoreStaleSnapshots } = await import('@/lib/program/score-stale');
  const { results, stoppedAtCap } = await scoreStaleSnapshots();
  for (const r of results) console.log(`${r.courseCode} ${r.snapshotId.slice(0, 8)}: ${r.status}${r.errorReason ? ` (${r.errorReason})` : ''}`);
  console.log(`scored ${results.filter(r => r.status === 'ok').length}, failed ${results.filter(r => r.status === 'failed').length}${stoppedAtCap ? ', STOPPED at the daily cost cap' : ''}`);

  // What changed: per newly scored competency, the courses that came out above zero (their course pages may need a rebuild).
  const ids = [...missing.keys()];
  for (const id of ids) {
    const rows = (await db.execute(sql`
      select s.course_code, c.k_depth, c.u_depth, c.d_depth from snapshot_competency_coverage c
      join course_capture_snapshots s on s.id = c.snapshot_id
      where c.competency_id = ${id} and c.snapshot_id::text = any(string_to_array(${results.filter(r => r.status === 'ok').map(r => r.snapshotId).join(',')}, ','))
      order by c.d_depth desc, s.course_code`)).rows as Array<{ course_code: string; k_depth: number | null; u_depth: number | null; d_depth: number }>;
    const above = rows.filter(r => r.d_depth > 0 || (r.k_depth ?? 0) > 0 || (r.u_depth ?? 0) > 0);
    console.log(`\n${id}: ${above.length} of ${rows.length} course(s) above zero`);
    for (const r of above) console.log(`  ${r.course_code}: K${r.k_depth ?? '-'} U${r.u_depth ?? '-'} D${r.d_depth}`);
  }
  return stoppedAtCap ? 3 : 0;
}

main().then(code => process.exit(code), err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
