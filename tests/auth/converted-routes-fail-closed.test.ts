// @vitest-environment node
/**
 * Spec 2026-10-08 §4: the five routes that used to check the shared password
 * themselves now authorize with the request's resolved grant + authorize()
 * rules, and FAIL CLOSED — with FACULTY_BASIC_AUTH / CREATE_ONLY_AUTH unset
 * (the old "no-op when unset" case) a request with no grant is rejected, and
 * an authorized grant is accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn(async () => ({ ok: true })), recordSpend: vi.fn() }));
vi.mock('@/lib/ai/transcribe', () => ({
  transcribeAudio: vi.fn(async () => ({ text: 'hello', model: 'm', backend: 'mlx' })),
  isSupportedAudioMime: () => true,
  estimateWhisperCostCents: () => 0,
}));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async (code: string) => ({ code })),
  clearCourseCanvasImport: vi.fn(async () => {}),
  updateCourseCanvasImport: vi.fn(async () => {}),
  createCourse: vi.fn(async () => {}),
  bulkCreateCourses: vi.fn(async () => ({ created: [], skipped: [] })),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(), listMaterialsByCourse: vi.fn(async () => []), deleteMaterial: vi.fn(),
  updateMaterialTier: vi.fn(), findMaterialByFileName: vi.fn(), updateMaterialMetadata: vi.fn(), updateExtractionResult: vi.fn(),
}));
vi.mock('@/lib/capture/vector-store', () => ({ createVectorStore: () => ({ deleteByMaterial: vi.fn() }), tenantForCourse: (c: string) => c }));
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_r: unknown, o: { slug?: string }) => o.slug === 'valid-slug' }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/app/courses/new/NewCourseForm', () => ({
  NewCourseForm: (p: { canCapture: boolean }) => `NEW-COURSE-FORM canCapture=${p.canCapture}`,
}));

const grants = new Map<string, unknown>();
vi.mock('@/lib/auth/grants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grants')>('@/lib/auth/grants');
  return { ...actual, findGrantById: vi.fn(async (id: string) => grants.get(id) ?? null) };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { headers } from 'next/headers';
import { signSession, SESSION_COOKIE } from '@/lib/auth/grants';
import * as materials from '@/app/api/courses/[code]/materials/route';
import * as imscc from '@/app/api/courses/[code]/imscc-import/route';
import * as transcribe from '@/app/api/transcribe/route';
import * as roster from '@/app/api/admin/courses/roster/route';
import NewCoursePage from '@/app/courses/new/page';

const SECRET = 'test-session-secret-0123456789';
const grant = (id: string, scope: string[], can: string[]) =>
  ({ id, label: `Grant ${id}`, scope, can, expiresAt: null, revokedAt: null, lastUsedAt: null });
const IDS = {
  gc1010: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  creator: '33333333-3333-4333-8333-333333333333',
  allCreate: '44444444-4444-4444-8444-444444444444',
};
const cookie = (id: string) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(signSession(id, SECRET))}` });
const basic = (s: string) => ({ authorization: 'Basic ' + Buffer.from(s).toString('base64') });

const env = { ...process.env };
beforeEach(() => {
  process.env = { ...env };
  delete process.env.FACULTY_BASIC_AUTH;
  delete process.env.CREATE_ONLY_AUTH;
  delete process.env.DEPARTMENT_LOGIN;
  process.env.SESSION_SECRET = SECRET;
  grants.clear();
  grants.set(IDS.gc1010, grant(IDS.gc1010, ['GC 1010'], ['capture']));
  grants.set(IDS.other, grant(IDS.other, ['GC 4400'], ['capture']));
  grants.set(IDS.creator, grant(IDS.creator, [], ['create']));
  grants.set(IDS.allCreate, grant(IDS.allCreate, ['*'], ['capture', 'create']));
});
afterEach(() => { process.env = { ...env }; });

const ctx = { params: Promise.resolve({ code: 'GC 1010' }) };

describe('materials route (matcher-excluded)', () => {
  const del = (h: Record<string, string> = {}) =>
    new Request('http://h/api/courses/GC%201010/materials?slug=valid-slug', { method: 'DELETE', headers: h });
  const post = (h: Record<string, string> = {}) => {
    const form = new FormData(); form.append('slug', 'valid-slug');
    return new Request('http://h/api/courses/GC%201010/materials', { method: 'POST', body: form, headers: h });
  };
  it('no grant → 401 (DELETE and POST), env unset', async () => {
    expect((await materials.DELETE(del(), ctx)).status).toBe(401);
    expect((await materials.POST(post(), ctx)).status).toBe(401);
  });
  it('a grant for another course → rejected', async () => {
    expect((await materials.DELETE(del(cookie(IDS.other)), ctx)).status).toBe(403);
  });
  it('a capture grant for this course → accepted', async () => {
    expect((await materials.DELETE(del(cookie(IDS.gc1010)), ctx)).status).toBe(200);
  });
  it('Basic with the env var unset is not a credential', async () => {
    expect((await materials.DELETE(del(basic('gcfaculty:pw')), ctx)).status).toBe(401);
  });
  it('DEPARTMENT_LOGIN=off: Basic with the env var set is rejected, no WWW-Authenticate', async () => {
    process.env.FACULTY_BASIC_AUTH = 'gcfaculty:pw';
    process.env.DEPARTMENT_LOGIN = 'off';
    const res = await materials.DELETE(del(basic('gcfaculty:pw')), ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });
  it('DEPARTMENT_LOGIN on: Basic faculty still accepted', async () => {
    process.env.FACULTY_BASIC_AUTH = 'gcfaculty:pw';
    expect((await materials.DELETE(del(basic('gcfaculty:pw')), ctx)).status).toBe(200);
  });
});

describe('imscc-import route (matcher-excluded)', () => {
  const post = (h: Record<string, string> = {}) => {
    const form = new FormData(); form.append('slug', 'valid-slug');
    return new Request('http://h/api/courses/GC%201010/imscc-import', { method: 'POST', body: form, headers: h });
  };
  it('no grant → 401, env unset', async () => {
    expect((await imscc.POST(post(), ctx)).status).toBe(401);
  });
  it('a grant for another course → rejected', async () => {
    expect((await imscc.POST(post(cookie(IDS.other)), ctx)).status).toBe(403);
  });
  it('a capture grant for this course → past auth (400: no file)', async () => {
    expect((await imscc.POST(post(cookie(IDS.gc1010)), ctx)).status).toBe(400);
  });
});

describe('transcribe route (matcher-excluded)', () => {
  const post = (h: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'recording');
    return new Request('https://x/api/transcribe?slug=valid-slug', { method: 'POST', body: form, headers: h });
  };
  it('no grant → 401, env unset', async () => {
    expect((await transcribe.POST(post())).status).toBe(401);
  });
  it('a create-only grant → rejected', async () => {
    expect((await transcribe.POST(post(cookie(IDS.creator)))).status).toBe(401);
  });
  it('a capture grant → 200', async () => {
    expect((await transcribe.POST(post(cookie(IDS.gc1010)))).status).toBe(200);
  });
  it('DEPARTMENT_LOGIN=off: Basic faculty rejected', async () => {
    process.env.FACULTY_BASIC_AUTH = 'gcfaculty:pw';
    process.env.DEPARTMENT_LOGIN = 'off';
    const res = await transcribe.POST(post(basic('gcfaculty:pw')));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });
});

describe('roster route', () => {
  const post = (body: unknown, h: Record<string, string> = {}) =>
    new Request('http://h/api/admin/courses/roster?slug=valid-slug', { method: 'POST', body: JSON.stringify(body), headers: h });
  const one = { mode: 'one', code: 'GC 9999', title: 'New' };
  const bulk = { mode: 'bulk', text: 'GC 9999 — New' };
  it('no grant → 401, env unset', async () => {
    expect((await roster.POST(post(one))).status).toBe(401);
    expect((await roster.POST(post(bulk))).status).toBe(401);
  });
  it('a capture-only grant cannot add a course', async () => {
    expect((await roster.POST(post(one, cookie(IDS.gc1010)))).status).toBe(403);
  });
  it('a create-only grant may add one course but not bulk-preload', async () => {
    expect((await roster.POST(post(one, cookie(IDS.creator)))).status).toBe(200);
    expect((await roster.POST(post(bulk, cookie(IDS.creator)))).status).toBe(403);
  });
  it('an all-courses create grant may bulk-preload', async () => {
    expect((await roster.POST(post(bulk, cookie(IDS.allCreate)))).status).toBe(200);
  });
});

describe('/courses/new page', () => {
  const render = async (h: Record<string, string>) => {
    vi.mocked(headers).mockResolvedValue(new Headers(h) as never);
    return renderToStaticMarkup(await NewCoursePage({ searchParams: Promise.resolve({ slug: 'valid-slug' }) }));
  };
  it('no grant → no form, env unset', async () => {
    const html = await render({});
    expect(html).not.toContain('NEW-COURSE-FORM');
  });
  it('a capture-only grant → no form', async () => {
    expect(await render(cookie(IDS.gc1010))).not.toContain('NEW-COURSE-FORM');
  });
  it('a create-only grant → form without the capture redirect', async () => {
    expect(await render(cookie(IDS.creator))).toContain('NEW-COURSE-FORM canCapture=false');
  });
  it('a capture+create grant → form with the capture redirect', async () => {
    expect(await render(cookie(IDS.allCreate))).toContain('NEW-COURSE-FORM canCapture=true');
  });
});
