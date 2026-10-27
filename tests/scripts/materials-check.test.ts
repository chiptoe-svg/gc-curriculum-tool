// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as lib from '../../scripts/materials/materials-check-lib.mjs';

const NOW = new Date('2026-10-28T12:00:00Z');
const row = (o: Record<string, unknown>) => ({
  course_code: 'GC 4400',
  file_name: 'Photo Book Assignment.docx',
  blob_url: '/api/storage/materials/gc-4400/1-Photo_Book_Assignment.docx',
  indexing_status: 'pending',
  extraction_status: 'pending',
  raw_cleared: false,
  ignored: false,
  retired_at: null,
  uploaded_at: '2026-10-21T14:23:22Z',
  ...o,
});

describe('classifyMaterial', () => {
  it('a failed file whose raw file is still on disk -> failed', () => {
    expect(lib.classifyMaterial(row({ indexing_status: 'failed' }), NOW)).toBe('failed');
  });
  it('a file waiting more than a day -> waiting', () => {
    for (const s of ['pending', 'queued', 'indexing']) {
      expect(lib.classifyMaterial(row({ indexing_status: s }), NOW)).toBe('waiting');
    }
  });
  it('a file waiting less than a day -> no problem', () => {
    expect(lib.classifyMaterial(row({ uploaded_at: '2026-10-28T00:00:00Z' }), NOW)).toBeNull();
  });
  it('an unread local file whose raw file was deleted -> lost', () => {
    expect(lib.classifyMaterial(row({ raw_cleared: true }), NOW)).toBe('lost');
    expect(lib.classifyMaterial(row({ raw_cleared: true, indexing_status: 'failed' }), NOW)).toBe('lost');
  });
  it('a failed remote item (no local file) is failed, never lost', () => {
    expect(lib.classifyMaterial(row({ blob_url: 'https://youtube.com/watch?v=x', raw_cleared: true, indexing_status: 'failed', extraction_status: 'ok' }), NOW)).toBe('failed');
  });
  it('read, ignored or retired files -> no problem', () => {
    expect(lib.classifyMaterial(row({ indexing_status: 'ready', extraction_status: 'ok' }), NOW)).toBeNull();
    expect(lib.classifyMaterial(row({ indexing_status: 'skipped' }), NOW)).toBeNull();
    expect(lib.classifyMaterial(row({ indexing_status: 'failed', ignored: true }), NOW)).toBeNull();
    expect(lib.classifyMaterial(row({ indexing_status: 'failed', retired_at: '2026-10-22T00:00:00Z' }), NOW)).toBeNull();
  });
});

describe('decideAction', () => {
  it.each([
    [1, null, 'open'],
    [1, { body: 'old' }, 'update'],
    [0, { body: 'old' }, 'close'],
    [0, null, 'none'],
  ])('%i problem(s), open issue %o -> %s', (n, open, want) => {
    expect(lib.decideAction(n > 0 ? 'new body' : '', open)).toBe(want);
  });
  it('an unchanged body is not rewritten', () => {
    expect(lib.decideAction('same', { body: 'same' })).toBe('none');
  });
});

describe('issueBody', () => {
  it('groups by course and says what to do for each kind', () => {
    const body = lib.issueBody([
      { ...row({ raw_cleared: true }), kind: 'lost' },
      { ...row({ course_code: 'GC 2070', file_name: 'YouTube: Garment', indexing_status: 'failed' }), kind: 'failed' },
    ]);
    expect(body).toContain('### GC 2070');
    expect(body).toContain('### GC 4400');
    expect(body).toContain('Photo Book Assignment.docx');
    expect(body).toMatch(/file is gone/i);
    expect(body).toMatch(/run Ingest/i);
    expect(body.indexOf('### GC 2070')).toBeLessThan(body.indexOf('### GC 4400'));
  });
});
