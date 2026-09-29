import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'board-'));
  process.env.DASHBOARD_DIR = root;
  await writeFile(path.join(root, 'index.html'), '<html><head><title>i</title></head><body>root</body></html>');
  await mkdir(path.join(root, 'curriculum'));
  await writeFile(path.join(root, 'curriculum/index.html'), '<html><head></head><body>page</body></html>');
  await writeFile(path.join(root, 'curriculum/state.json'), '{"ok":true}');
  await writeFile(path.join(root, 'curriculum/roadmap.md'), '# r');
  await writeFile(path.join(root, 'secret.txt'), 'nope');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const call = async (segs: string[]) => {
  const { GET } = await import('@/app/board/[[...path]]/route');
  return GET(new Request('http://x/board/' + segs.join('/')), { params: Promise.resolve({ path: segs }) });
};

describe('/board route', () => {
  it('serves the project index with a <base> so relative fetches resolve under the project', async () => {
    const r = await call(['curriculum']);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<base href="/board/curriculum/">');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('serves state.json and roadmap.md with their types', async () => {
    const s = await call(['curriculum', 'state.json']);
    expect(s.status).toBe(200); expect(s.headers.get('content-type')).toContain('application/json');
    const m = await call(['curriculum', 'roadmap.md']);
    expect(m.status).toBe(200); expect(await m.text()).toBe('# r');
  });
  it('serves the root index with base /board/', async () => {
    const r = await call([]);
    expect(await r.text()).toContain('<base href="/board/">');
  });
  it('404s anything outside the allow-list', async () => {
    for (const segs of [['curriculum', 'secret.txt'], ['..', 'index.html'], ['curriculum', '..'], ['secret.txt'], ['a', 'b', 'c'], ['nope']]) {
      expect((await call(segs)).status).toBe(404);
    }
  });
});
