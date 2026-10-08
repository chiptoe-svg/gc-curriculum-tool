// @vitest-environment node
/**
 * Adversarial review of feat/retire-shared-password (spec 2026-10-08).
 * Each test is an attack; a passing test means the attack failed (or, where
 * named "DOCUMENTS", pins a known accepted-risk behavior so a change to it is
 * visible).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

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
vi.mock('@/lib/sandbox/sessions', async () => ({
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
  lookupScopedSession: vi.fn(async (id: string) => (id === 'sess-gc1010' ? { courseCode: 'GC 1010', instructorName: 'T', grantId: 'g' } : null)),
}));
vi.mock('@/lib/sandbox/grants', async () => ({ getGrantById: vi.fn(async () => ({ id: 'g' })), isGrantValid: () => true }));

const grants = new Map<string, unknown>();
vi.mock('@/lib/auth/grants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grants')>('@/lib/auth/grants');
  return { ...actual, findGrantById: vi.fn(async (id: string) => grants.get(id) ?? null) };
});

import { gate, type GateDeps } from '@/lib/auth/gate';
import { signSession, hashToken, SESSION_COOKIE, type StoredGrant } from '@/lib/auth/grants';
import { departmentLoginEnabled } from '@/lib/auth/auth-env';
import * as materials from '@/app/api/courses/[code]/materials/route';
import * as imscc from '@/app/api/courses/[code]/imscc-import/route';
import * as transcribe from '@/app/api/transcribe/route';
import * as roster from '@/app/api/admin/courses/roster/route';

const SECRET = 'adv-secret-0123456789abcdef0123';
const fp = (cred: string) => createHmac('sha256', SECRET).update(cred).digest('hex').slice(0, 16);
const sg = (id: string, scope: string[], can: StoredGrant['can'], extra: Partial<StoredGrant> = {}): StoredGrant =>
  ({ id, label: `G ${id.slice(0, 4)}`, scope, can, expiresAt: null, revokedAt: null, lastUsedAt: null, ...extra });
const IDS = {
  gc1010: '11111111-1111-4111-8111-111111111111',
  revoked: '22222222-2222-4222-8222-222222222222',
  expired: '33333333-3333-4333-8333-333333333333',
  creator: '44444444-4444-4444-8444-444444444444',
  owner: '55555555-5555-4555-8555-555555555555',
  nocap: '66666666-6666-4666-8666-666666666666',
  messyScope: '77777777-7777-4777-8777-777777777777',
};
const G = {
  gc1010: sg(IDS.gc1010, ['GC 1010'], ['capture']),
  revoked: sg(IDS.revoked, ['*'], ['capture', 'create', 'admin'], { revokedAt: new Date('2026-01-01') }),
  expired: sg(IDS.expired, ['*'], ['capture', 'create', 'admin'], { expiresAt: new Date('2026-01-01') }),
  creator: sg(IDS.creator, [], ['create']),
  owner: sg(IDS.owner, ['*'], ['capture', 'create', 'admin']),
  nocap: sg(IDS.nocap, ['*'], []),
  messyScope: sg(IDS.messyScope, ['  gc   1010 '], ['capture']),
};
const cookieH = (id: string, secret = SECRET) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(signSession(id, secret))}` });
const basicH = (s: string) => ({ authorization: 'Basic ' + Buffer.from(s).toString('base64') });

const env = { ...process.env };
beforeEach(() => {
  process.env = { ...env };
  delete process.env.FACULTY_BASIC_AUTH;
  delete process.env.CREATE_ONLY_AUTH;
  delete process.env.DEPARTMENT_LOGIN;
  process.env.SESSION_SECRET = SECRET;
  grants.clear();
  for (const g of Object.values(G)) grants.set(g.id, g);
});
afterEach(() => { process.env = { ...env }; });

// ---------------------------------------------------------------- gate() ---
const OWNER_TOKEN = 'tok_owner', LOW_TOKEN = 'tok_low';
function deps(e: Partial<GateDeps['env']> = {}): GateDeps {
  return {
    findGrantByToken: async t => (hashToken(t) === hashToken(OWNER_TOKEN) ? G.owner : hashToken(t) === hashToken(LOW_TOKEN) ? G.gc1010 : null),
    findGrantById: async id => (grants.get(id) as StoredGrant) ?? null,
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'fac:pw', creator: 'cre:pw', slug: 'valid-slug', ...e },
    now: () => new Date('2026-10-08T12:00:00Z'),
  };
}
const greq = (path: string, init: { method?: string; headers?: Record<string, string>; base?: string } = {}) =>
  new NextRequest(new URL(path, init.base ?? 'https://gcworkflow.clemson.edu:8443'), { method: init.method ?? 'GET', headers: init.headers ?? {} });
const deptCookie = { cookie: `gc_session=${signSession(`builtin:faculty:${fp('fac:pw')}`, SECRET)}` };
const isDenied = (r: Awaited<ReturnType<typeof gate>>) => r.kind === 'response' && (r.status === 401 || r.status === 403);

const GATED = ['/admin', '/admin/access', '/api/admin/access', '/capture/GC%201010', '/courses', '/board/x', '/api/courses/GC%201010/context', '/api/transcribe', '/settings', '/ask'];

describe('(a) nothing gated without a credential', () => {
  for (const [name, e] of [
    ['all credential env unset', { sessionSecret: undefined, faculty: undefined, creator: undefined }],
    ['DEPARTMENT_LOGIN off', { departmentLogin: false }],
    ['no SESSION_SECRET, Basic set', { sessionSecret: undefined }],
  ] as const) {
    for (const m of ['GET', 'HEAD', 'POST', 'OPTIONS', 'DELETE']) {
      it(`${name}: ${m} on every gated path with no credential → denied`, async () => {
        for (const p of GATED) expect(isDenied(await gate(greq(p, { method: m }), deps(e))), `${m} ${p}`).toBe(true);
      });
    }
  }
  it('env unset: a Basic header of empty/colon creds is not a credential', async () => {
    const d = deps({ faculty: undefined, creator: undefined });
    for (const s of ['', ':', 'undefined:undefined', 'fac:pw']) expect(isDenied(await gate(greq('/admin', { headers: basicH(s) }), d))).toBe(true);
  });
  it('off: forged gc_session (wrong secret / tampered MAC / bare builtin id) → denied', async () => {
    const forged = [
      `gc_session=${signSession(IDS.owner, 'wrong-secret')}`,
      `gc_session=${signSession(IDS.owner, SECRET).slice(0, -2)}xx`,
      `gc_session=builtin:faculty`,
      `gc_session=${signSession('builtin:faculty', SECRET)}`,
    ];
    for (const c of forged) expect(isDenied(await gate(greq('/admin', { headers: { cookie: c } }), deps({ departmentLogin: false })))).toBe(true);
  });
  it('revoked / expired personal cookie → denied and cleared', async () => {
    for (const id of [IDS.revoked, IDS.expired]) {
      const r = await gate(greq('/admin', { headers: cookieH(id) }), deps({ departmentLogin: false }));
      expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
    }
  });
  it('client-supplied x-gc-* / x-forwarded-* / x-middleware-* headers grant nothing', async () => {
    const h = { 'x-gc-grant': IDS.owner, 'x-gc-role': 'admin', 'x-forwarded-user': 'owner', 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware', 'x-forwarded-proto': 'https' };
    expect(isDenied(await gate(greq('/admin', { headers: h }), deps({ departmentLogin: false })))).toBe(true);
  });
});

describe('(c) session fixation via ?key=', () => {
  const ownerCookie = cookieH(IDS.owner);
  it('live personal session + attacker key (public /, gated page, HEAD) → never swapped', async () => {
    for (const [p, m] of [['/?key=' + LOW_TOKEN, 'GET'], ['/courses?key=' + LOW_TOKEN, 'GET'], ['/courses?key=' + LOW_TOKEN, 'HEAD'], ['/wiki?key=' + LOW_TOKEN, 'GET']] as const) {
      const r = await gate(greq(p, { method: m, headers: ownerCookie }), deps());
      expect(r.kind).not.toBe('redirect');
      if ('setCookie' in r) expect(r.setCookie).toBeUndefined();
    }
  });
  it('duplicate key params / key on an /api/ path / key on POST → no exchange', async () => {
    expect((await gate(greq(`/courses?key=${LOW_TOKEN}&key=${OWNER_TOKEN}`, { headers: ownerCookie }), deps())).kind).not.toBe('redirect');
    expect((await gate(greq(`/api/admin/access?key=${OWNER_TOKEN}`), deps({ departmentLogin: false }))).kind).toBe('response');
    expect((await gate(greq(`/courses?key=${OWNER_TOKEN}`, { method: 'POST' }), deps({ departmentLogin: false }))).kind).toBe('response');
  });
  it('DOCUMENTS accepted risk: department session + another faculty member\'s low-privilege key → swapped to that key\'s grant', async () => {
    const r = await gate(greq(`/?key=${LOW_TOKEN}`, { headers: deptCookie }), deps());
    expect(r.kind).toBe('redirect'); if (r.kind === 'redirect') expect(r.setCookie.value.startsWith(IDS.gc1010 + '.')).toBe(true);
  });
});

describe('open redirect in the key exchange', () => {
  for (const p of [`//evil.example/x?key=${OWNER_TOKEN}`, `/\\evil.example/x?key=${OWNER_TOKEN}`, `/%2F%2Fevil.example?key=${OWNER_TOKEN}`]) {
    for (const origin of ['https://gcworkflow.clemson.edu:8443', undefined]) {
      it(`${p} (publicOrigin=${origin ?? 'unset'}) stays on-origin`, async () => {
        // Build the URL with a literal pathname (new URL('//x', base) would make
        // the REQUEST itself off-origin, which is not the attack).
        const u = new URL('https://gcworkflow.clemson.edu:8443/');
        const [path, q] = p.split('?');
        u.pathname = path ?? ""; u.search = "?" + (q ?? "");
        expect(u.host).toBe('gcworkflow.clemson.edu:8443');
        const r = await gate(new NextRequest(u), deps({ publicOrigin: origin }));
        expect(r.kind).toBe('redirect');
        if (r.kind === 'redirect') expect(r.url.host).toBe('gcworkflow.clemson.edu:8443');
      });
    }
  }
});

describe('DEPARTMENT_LOGIN parsing', () => {
  it('off / on / unset', () => {
    expect(departmentLoginEnabled('off')).toBe(false);
    expect(departmentLoginEnabled('on')).toBe(true);
    expect(departmentLoginEnabled(undefined)).toBe(true);
  });
  it('near-miss spellings of "off" also turn the shared password off (should-fix applied)', () => {
    for (const v of ['OFF', 'Off', ' off', 'off ', 'off\n', '"off"', 'false', '0', 'no', 'disabled']) expect(departmentLoginEnabled(v), JSON.stringify(v)).toBe(false);
    for (const v of [undefined, '', 'on', 'ON', ' on ', 'yes', 'offf']) expect(departmentLoginEnabled(v), JSON.stringify(v)).toBe(true);
  });
});

// ------------------------------------------------------ converted routes ---
const ctx = (code: string) => ({ params: Promise.resolve({ code }) });
const matReq = (method: 'POST' | 'DELETE', pathCode: string, h: Record<string, string> = {}, slug = 'nope') => {
  if (method === 'DELETE') return new Request(`http://h/api/courses/${pathCode}/materials?slug=${slug}`, { method, headers: h });
  const form = new FormData(); form.append('slug', slug);
  return new Request(`http://h/api/courses/${pathCode}/materials`, { method, body: form, headers: h });
};
const NOT_AUTHED = (s: number) => s === 401 || s === 403;

describe('(e) converted routes authorize per scope/capability and fail closed', () => {
  it('GC 1010 grant cannot write materials of GC 3460 (POST + DELETE), even with the valid slug', async () => {
    for (const m of ['POST', 'DELETE'] as const) {
      expect(NOT_AUTHED((await materials[m](matReq(m, 'GC%203460', cookieH(IDS.gc1010), 'valid-slug'), ctx('GC 3460'))).status)).toBe(true);
    }
  });
  it('GC 1010 grant: case/whitespace/encoding variants of another code or its own code do not slip through', async () => {
    for (const pc of ['gc%203460', 'GC%203460%20', 'GC%20%203460', 'GC%25203460', '%20GC%203460', 'gc%201010', 'GC%201010%2F..%2FGC%203460']) {
      const decoded = decodeURIComponent(pc);
      expect(NOT_AUTHED((await materials.DELETE(matReq('DELETE', pc, cookieH(IDS.gc1010), 'valid-slug'), ctx(decoded))).status), pc).toBe(true);
    }
  });
  it('messy stored scope "  gc   1010 " still authorizes exactly GC 1010', async () => {
    expect((await materials.DELETE(matReq('DELETE', 'GC%201010', cookieH(IDS.messyScope), 'valid-slug'), ctx('GC 1010'))).status).toBe(200);
    expect(NOT_AUTHED((await materials.DELETE(matReq('DELETE', 'GC%203460', cookieH(IDS.messyScope), 'valid-slug'), ctx('GC 3460'))).status)).toBe(true);
  });
  it('sandbox session bound to GC 1010 cannot upload/import into GC 3460', async () => {
    const h = { cookie: 'gc_sandbox_sess=sess-gc1010' };
    expect(NOT_AUTHED((await materials.POST(matReq('POST', 'GC%203460', h), ctx('GC 3460'))).status)).toBe(true);
    const form = new FormData(); form.append('slug', 'nope');
    expect(NOT_AUTHED((await imscc.POST(new Request('http://h/api/courses/GC%203460/imscc-import', { method: 'POST', body: form, headers: h }), ctx('GC 3460'))).status)).toBe(true);
  });
  it('revoked / expired / forged / no-secret cookies → 401 on every converted route', async () => {
    const bad = [cookieH(IDS.revoked), cookieH(IDS.expired), cookieH(IDS.owner, 'other-secret'), { cookie: `${SESSION_COOKIE}=${IDS.owner}.AAAA` }];
    for (const h of bad) {
      expect((await materials.DELETE(matReq('DELETE', 'GC%201010', h, 'valid-slug'), ctx('GC 1010'))).status).toBe(401);
      expect((await transcribe.POST(new Request('https://x/api/transcribe', { method: 'POST', body: new FormData(), headers: h }))).status).toBe(401);
      expect((await roster.POST(new Request('http://h/api/admin/courses/roster?slug=valid-slug', { method: 'POST', body: JSON.stringify({ mode: 'one', code: 'GC 9999', title: 'x' }), headers: h }))).status).toBe(401);
    }
    delete process.env.SESSION_SECRET;
    expect((await materials.DELETE(matReq('DELETE', 'GC%201010', cookieH(IDS.owner), 'valid-slug'), ctx('GC 1010'))).status).toBe(401);
  });
  it('builtin department cookie when DEPARTMENT_LOGIN=off → 401 on every converted route', async () => {
    process.env.FACULTY_BASIC_AUTH = 'fac:pw';
    process.env.DEPARTMENT_LOGIN = 'off';
    const h = deptCookie;
    expect((await materials.DELETE(matReq('DELETE', 'GC%201010', h, 'valid-slug'), ctx('GC 1010'))).status).toBe(401);
    expect((await transcribe.POST(new Request('https://x/api/transcribe', { method: 'POST', body: new FormData(), headers: h }))).status).toBe(401);
    const form = new FormData(); form.append('slug', 'valid-slug');
    expect((await imscc.POST(new Request('http://h/api/courses/GC%201010/imscc-import', { method: 'POST', body: form, headers: h }), ctx('GC 1010'))).status).toBe(401);
  });
  it('capability-less grant cannot transcribe; create-less grant cannot add a course; create-only cannot bulk', async () => {
    expect((await transcribe.POST(new Request('https://x/api/transcribe', { method: 'POST', body: new FormData(), headers: cookieH(IDS.nocap) }))).status).toBe(401);
    const r = (body: unknown, h: Record<string, string>) => new Request('http://h/api/admin/courses/roster?slug=valid-slug', { method: 'POST', body: JSON.stringify(body), headers: h });
    expect((await roster.POST(r({ mode: 'one', code: 'GC 9999', title: 'x' }, cookieH(IDS.nocap)))).status).toBe(403);
    expect((await roster.POST(r({ mode: 'bulk', text: 'GC 9999 — x' }, cookieH(IDS.creator)))).status).toBe(403);
    process.env.CREATE_ONLY_AUTH = 'cre:pw';
    expect((await roster.POST(r({ mode: 'bulk', text: 'GC 9999 — x' }, basicH('cre:pw')))).status).toBe(403);
  });
  it('Basic is not a credential on converted routes when its env var is unset, even with DEPARTMENT_LOGIN=on', async () => {
    process.env.DEPARTMENT_LOGIN = 'on';
    for (const s of ['fac:pw', ':', 'undefined:undefined']) {
      expect((await materials.DELETE(matReq('DELETE', 'GC%201010', basicH(s), 'valid-slug'), ctx('GC 1010'))).status).toBe(401);
    }
  });
});
