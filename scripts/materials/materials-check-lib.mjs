// Pure helpers for scripts/materials/materials-check.mjs (unit-tested in tests/scripts/materials-check.test.ts).

export const LABEL = 'materials-alert';
export const ISSUE_TITLE = 'Course materials could not be read';
export const WAIT_LIMIT_MS = 24 * 60 * 60 * 1000;

const WAITING = new Set(['pending', 'queued', 'indexing']);
const isLocal = (blobUrl) => (blobUrl ?? '').startsWith('/api/storage/');

/**
 * course_materials row -> 'lost' | 'failed' | 'waiting' | null.
 * lost: a local upload that was never read and whose raw file is already deleted
 * (only a new upload brings it back). failed: reading failed; the file is kept
 * for a retry. waiting: not read after a day (e.g. Ingest never run).
 */
export function classifyMaterial(r, now) {
  if (r.ignored || r.retired_at) return null;
  const failed = r.indexing_status === 'failed';
  const waiting = WAITING.has(r.indexing_status) && now - new Date(r.uploaded_at) > WAIT_LIMIT_MS;
  if (!failed && !waiting) return null;
  if (r.raw_cleared && isLocal(r.blob_url) && r.extraction_status !== 'ok') return 'lost';
  return failed ? 'failed' : 'waiting';
}

const ACTION = {
  lost: 'The file is gone (deleted before it was read). Ask the instructor to upload it again, then remove the old entry.',
  failed: 'Reading failed; the file is kept. Open the course in CourseCapture and run Ingest again; if it fails again, check the app log.',
  waiting: 'Not read after a day. Open the course in CourseCapture and run Ingest.',
};
const KIND_LABEL = { lost: 'File gone', failed: 'Failed', waiting: 'Waiting' };

/** Issue body: one section per course (sorted), one line per file, then what to do per kind. No timestamp, so an unchanged list is not rewritten. */
export function issueBody(problems) {
  const byCourse = new Map();
  for (const p of problems) {
    if (!byCourse.has(p.course_code)) byCourse.set(p.course_code, []);
    byCourse.get(p.course_code).push(p);
  }
  const out = [`${problems.length} course material(s) have not been read.`, ''];
  for (const course of [...byCourse.keys()].sort()) {
    out.push(`### ${course}`, '');
    for (const p of byCourse.get(course).sort((a, b) => a.file_name.localeCompare(b.file_name))) {
      out.push(`- **${KIND_LABEL[p.kind]}:** ${p.file_name} (uploaded ${String(p.uploaded_at).slice(0, 10)})`);
    }
    out.push('');
  }
  out.push('**What to do**', '');
  for (const kind of ['lost', 'failed', 'waiting']) {
    if (problems.some(p => p.kind === kind)) out.push(`- **${KIND_LABEL[kind]}:** ${ACTION[kind]}`);
  }
  out.push('', 'This issue updates daily and closes automatically when every material has been read, removed or set aside.');
  return out.join('\n');
}

/** body ('' = no problems), open issue or null -> 'open' | 'update' | 'close' | 'none'. */
export function decideAction(body, open) {
  if (!body) return open ? 'close' : 'none';
  if (!open) return 'open';
  return (open.body ?? '').trim() === body.trim() ? 'none' : 'update';
}
