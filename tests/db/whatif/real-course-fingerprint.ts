// One SHA-256 per store that describes the real course, for the what-if invariant test.
// Each database hash covers every column of every row (the row's text form), ordered by
// primary key text, so any inserted, deleted or edited row changes it.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseSlug, STORAGE_ROOT } from '@/lib/storage/local-storage';

const run = promisify(execFile);

// table -> [where clause for the course (null = the whole table, no course column), order by]
function stores(code: string): Array<[string, SQL | null, string]> {
  const snapshotIds = sql`(SELECT id FROM course_capture_snapshots WHERE course_code = ${code})`;
  return [
    ['course_capture_snapshots', sql`t.course_code = ${code}`, 't.id::text'],
    ['course_capture_profiles', sql`t.course_code = ${code}`, 't.course_code::text'],
    ['capture_conversations', sql`t.course_code = ${code}`, 't.course_code::text'],
    ['capture_messages', sql`t.course_code = ${code}`, 't.id::text'],
    ['capture_sessions', sql`t.course_code = ${code}`, 't.session_id::text'],
    ['course_materials', sql`t.course_code = ${code}`, 't.id::text'],
    ['item_embeddings', null, "t.kind::text, t.ref::text, t.model::text, t.text_hash::text"],
    ['snapshot_competency_coverage', sql`t.snapshot_id IN ${snapshotIds}`, 't.snapshot_id::text, t.competency_id::text'],
    ['course_intended_coverage', sql`t.course_code = ${code}`, 't.course_code::text, t.sub_competency_id::text'],
    ['prerequisite_edges', sql`(t.focal_course_code = ${code} OR t.prereq_course_code = ${code})`, 't.id::text'],
    ['course_explore_scenarios', sql`t.course_code = ${code}`, 't.id::text'],
    ['prototype_runs', null, 't.id::text'],
  ];
}

async function tableHash(table: string, where: SQL | null, orderBy: string): Promise<{ hash: string; rows: number }> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n,
           encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY ${sql.raw(orderBy)}), ''), 'UTF8')), 'hex') AS h
    FROM ${sql.raw(table)} t
    WHERE ${where ?? sql`TRUE`}`);
  const row = result.rows[0] as { n: number; h: string };
  return { hash: row.h, rows: row.n };
}

async function listing(dir: string): Promise<string> {
  let names: string[];
  try { names = await fs.readdir(dir); } catch { return ''; }
  const lines: string[] = [];
  for (const name of names.sort()) {
    const st = await fs.stat(path.join(dir, name));
    lines.push(`${name}\t${st.size}\t${st.mtimeMs}`);
  }
  return lines.join('\n');
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Keys: one per store (its SHA-256), `<store>#rows` (its row count, so a failure also shows the size),
 * `files` (hash of path, size, mtime of the course's material directory under STORAGE_ROOT),
 * `wiki.head` (git rev-parse HEAD) and `wiki.status` (git status --porcelain), both of the clone at wikiPath.
 */
export async function fingerprintRealCourse(courseCode: string, wikiPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [table, where, orderBy] of stores(courseCode)) {
    const { hash, rows } = await tableHash(table, where, orderBy);
    out[table] = hash;
    out[`${table}#rows`] = String(rows);
  }
  out.files = sha(await listing(path.join(STORAGE_ROOT, courseSlug(courseCode))));
  out['wiki.head'] = (await run('git', ['-C', wikiPath, 'rev-parse', 'HEAD'])).stdout.trim();
  out['wiki.status'] = sha((await run('git', ['-C', wikiPath, 'status', '--porcelain'])).stdout);
  return out;
}
