/**
 * Read-only extractor for the shortfall-trace test. SELECTs only, inside a READ ONLY transaction.
 * Usage: pnpm tsx scripts/analysis/shortfall-trace/extract.ts <out.json>
 * The DB URL comes from the app's own env loader (never printed).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { buildExtract, type RawRows } from './extract-build';

const TARGET = 'production-operations';
const PATH = ['GC 1020', 'GC 1050', 'GC 1040', 'GC 2070', 'GC 3460', 'GC 4400', 'GC 4060', 'GC 4440', 'GC 4480'];
const COMPETENCIES = ['domain-knowledge', 'quality-control', 'color-management', 'workflow-design', 'cost-management', 'packaging-artwork-compliance', 'attention-to-detail'];
const APP_DIR = '/Users/admin/projects/curriculum_developer';

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: extract.ts <out.json>');
  const url = execFileSync('node', [path.join(homedir(), '.claude/dashboard/read-env.mjs'), APP_DIR, 'DATABASE_URL']).toString();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('set default_transaction_read_only = on');
    await client.query('begin read only');
    const q = async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];

    const [target] = await q<{ id: string; name: string }>('select id, name from career_targets where id = $1', [TARGET]);
    if (!target) throw new Error(`career target ${TARGET} not found`);
    const competencies = (await q<{ id: string; name: string; foundational: boolean; weight: number | null; basis: string }>(
      `select s.id, s.name, s.foundational, m.effective_weight as weight, m.basis
       from sub_competencies s join career_target_membership m on m.competency_id = s.id and m.career_target_id = $1
       where s.id = any($2) and not s.retired`, [TARGET, COMPETENCIES]));
    const missing = COMPETENCIES.filter(c => !competencies.some(x => x.id === c));
    if (missing.length) throw new Error(`competencies not in the target's membership: ${missing.join(', ')}`);
    competencies.sort((a, b) => COMPETENCIES.indexOf(a.id) - COMPETENCIES.indexOf(b.id));

    const titles = Object.fromEntries((await q<{ code: string; title: string }>('select upper(code) as code, title from courses where upper(code) = any($1)', [PATH])).map(r => [r.code, r.title]));
    const snaps = await q<{ id: string; course: string; instructor: string | null; created_at: Date }>(
      'select id, upper(course_code) as course, instructor_name as instructor, created_at from course_capture_snapshots where retired_at is null and upper(course_code) = any($1)', [PATH]);
    const snapshots = snaps.map(s => ({ id: s.id, course: s.course, instructor: s.instructor, createdAt: new Date(s.created_at).toISOString() }));
    const ids = snapshots.map(s => s.id);
    const scored = (await q<{ snapshot_id: string }>('select distinct snapshot_id from snapshot_competency_coverage where snapshot_id = any($1::uuid[])', [ids])).map(r => r.snapshot_id);
    const levels = (await q<{ snapshot_id: string; competency_id: string; k_depth: number | null; u_depth: number | null; d_depth: number; method: string }>(
      'select snapshot_id, competency_id, k_depth, u_depth, d_depth, method from competency_levels where snapshot_id = any($1::uuid[]) and competency_id = any($2)', [ids, COMPETENCIES]))
      .map(r => ({ snapshotId: r.snapshot_id, competencyId: r.competency_id, k: r.k_depth, u: r.u_depth, d: r.d_depth, method: r.method }));
    const prereqs = (await q<{ course: string; prereq: string; kind: string }>(
      'select upper(course_code) as course, upper(prereq_code) as prereq, kind from course_catalog_prereqs where upper(course_code) = any($1) and upper(prereq_code) = any($1) order by 1, 2', [PATH]));
    await client.query('rollback');

    const raw: RawRows = { target, path: PATH, competencies, titles, snapshots, scored, levels, prereqs };
    const extract = { generatedAt: new Date().toISOString(), ...buildExtract(raw) };
    writeFileSync(out, JSON.stringify(extract, null, 1));
    console.log(`wrote ${out}: ${extract.courses.filter(c => c.captured).length}/${extract.courses.length} courses captured, ${extract.competencies.length} competencies, ${extract.prereqs.length} path prerequisites`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
