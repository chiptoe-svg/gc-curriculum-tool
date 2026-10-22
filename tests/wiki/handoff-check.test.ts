import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
vi.mock('@/lib/db/client', () => ({ db: {} }));
import { checkHandoffDir } from '@/scripts/wiki/handoff-check';

let dir: string;
const request = (key: string, paths: string[]) => {
  mkdirSync(path.join(dir, 'requests'), { recursive: true });
  writeFileSync(path.join(dir, 'requests', `${key}.json`), JSON.stringify({ key, userMessage: JSON.stringify({ affectedWikiPages: paths.map(p => ({ path: p })) }) }));
};
const response = (key: string, body: unknown) => {
  mkdirSync(path.join(dir, 'responses'), { recursive: true });
  writeFileSync(path.join(dir, 'responses', `${key}.json`), typeof body === 'string' ? body : JSON.stringify(body));
};
const page = (p: string) => ({ path: p, operation: 'update', content: '# T\n' });

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'handoff-check-')); });

describe('checkHandoffDir', () => {
  it('passes a complete, valid reply and counts pending requests', () => {
    request('a1', ['courses/gc-1010.md']); response('a1', { pages: [page('courses/gc-1010.md')], log_entry: 'x' });
    request('b2', ['index.md']);
    const r = checkHandoffDir(dir);
    expect(r.ok).toBe(true);
    expect(r.lines).toContain('a1 OK (1 page)');
    expect(r.pending).toEqual(['b2']);
  });

  it('fails a reply with no request, invalid JSON, a failed schema, or a missing requested page', () => {
    response('zz', { pages: [] });
    request('c3', ['x.md']); response('c3', '{not json');
    request('d4', ['y.md']); response('d4', { nope: 1 });
    request('e5', ['p.md', 'q.md']); response('e5', { pages: [page('p.md')], log_entry: 'x' });
    const r = checkHandoffDir(dir);
    expect(r.ok).toBe(false);
    const text = r.lines.join('\n');
    expect(text).toMatch(/zz FAIL: no matching request/);
    expect(text).toMatch(/c3 FAIL: invalid JSON/);
    expect(text).toMatch(/d4 FAIL/);
    expect(text).toMatch(/e5 FAIL: missing page\(s\): q\.md/);
  });
});
