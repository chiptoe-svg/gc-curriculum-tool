import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { requiresBasicAuth } from '@/lib/auth/basic-auth';

let file: string;
async function route() {
  vi.resetModules();
  process.env.TOUR_SIGNUPS_FILE = file;
  return import('@/app/api/tours/route');
}
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/tours', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'tours-')), 'signups.json');
});

describe('/api/tours', () => {
  it('starts empty', async () => {
    const { GET } = await route();
    expect(await (await GET()).json()).toEqual({ ok: true, rows: [] });
  });

  it('saves a sign-up to the file and lists it', async () => {
    const { GET, POST } = await route();
    const res = await POST(post({ name: '  Avery   Jordan ', tue: true, wed: false }));
    expect(res.status).toBe(200);
    expect((await (await GET()).json()).rows).toEqual([{ name: 'Avery Jordan', tue: true, wed: false }]);
    expect(JSON.parse(readFileSync(file, 'utf-8'))[0].name).toBe('Avery Jordan');
  });

  it('the same name again updates choices instead of adding a row', async () => {
    const { POST } = await route();
    await POST(post({ name: 'Sam Lee', tue: true, wed: false }));
    const res = await POST(post({ name: 'sam lee', tue: false, wed: true }));
    expect((await res.json()).rows).toEqual([{ name: 'sam lee', tue: false, wed: true }]);
  });

  it('concurrent submits are all kept', async () => {
    const { POST, GET } = await route();
    await Promise.all(['A', 'B', 'C', 'D', 'E'].map(n => POST(post({ name: n, tue: true }))));
    expect((await (await GET()).json()).rows).toHaveLength(5);
  });

  it('rejects no tour, no name, and bad JSON', async () => {
    const { POST } = await route();
    expect((await POST(post({ name: 'X' }))).status).toBe(400);
    expect((await POST(post({ name: '  ', wed: true }))).status).toBe(400);
    const bad = new NextRequest('http://localhost/api/tours', { method: 'POST', body: '{' });
    expect((await POST(bad)).status).toBe(400);
  });

  it('page, photo and endpoint are public; neighbors stay gated', () => {
    expect(requiresBasicAuth('/tours/signup.html')).toBe(false);
    expect(requiresBasicAuth('/tours/godfrey-hall.jpg')).toBe(false);
    expect(requiresBasicAuth('/api/tours')).toBe(false);
    expect(requiresBasicAuth('/toursx')).toBe(true);
    expect(requiresBasicAuth('/api/toursx')).toBe(true);
  });
});
