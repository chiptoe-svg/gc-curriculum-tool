// @vitest-environment node
/**
 * Owner, 2026-10-07 ("fix the voice"): faculty using a personal access link
 * (scoped grant, gc_session cookie) could not use Voice — /api/transcribe is
 * outside the middleware matcher and accepted only the shared Basic Auth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn(async () => ({ ok: true })), recordSpend: vi.fn() }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'iphash' }));
vi.mock('@/lib/ai/transcribe', () => ({
  transcribeAudio: vi.fn(async () => ({ text: 'hello', model: 'm', backend: 'mlx' })),
  isSupportedAudioMime: () => true,
  estimateWhisperCostCents: () => 0,
}));
const grants = new Map<string, unknown>();
vi.mock('@/lib/auth/grants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grants')>('@/lib/auth/grants');
  return { ...actual, findGrantById: vi.fn(async (id: string) => grants.get(id) ?? null) };
});

import { POST } from '@/app/api/transcribe/route';
import { signSession, SESSION_COOKIE } from '@/lib/auth/grants';

const SECRET = 'test-session-secret-0123456789';
const SLUG = 'test-slug';
const env = { ...process.env };

function req(headers: Record<string, string>): Request {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'recording');
  return new Request(`https://x/api/transcribe?slug=${SLUG}`, { method: 'POST', body: form, headers });
}
const cookieFor = (id: string) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(signSession(id, SECRET))}` });
const live = (can: string[]) => ({ id: 'g1', label: 'Jane Doe', scope: ['MKT 4320'], can, expiresAt: null, revokedAt: null, lastUsedAt: null });

beforeEach(() => {
  process.env.FACULTY_BASIC_AUTH = 'faculty:pw';
  process.env.SESSION_SECRET = SECRET;
  process.env.PROTOTYPE_SLUG = SLUG;
  grants.clear();
});
afterEach(() => { process.env = { ...env }; });

describe('/api/transcribe — personal access links', () => {
  it('a live link with capture permission can transcribe', async () => {
    grants.set('g1', live(['capture']));
    const res = await POST(req(cookieFor('g1')));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'hello' });
  });

  it('no credentials → 401', async () => {
    expect((await POST(req({}))).status).toBe(401);
  });

  it('a create-only link cannot transcribe', async () => {
    grants.set('g1', live(['create']));
    expect((await POST(req(cookieFor('g1')))).status).toBe(401);
  });

  it('a revoked link cannot transcribe', async () => {
    grants.set('g1', { ...live(['capture']), revokedAt: new Date() });
    expect((await POST(req(cookieFor('g1')))).status).toBe(401);
  });

  it('a tampered cookie cannot transcribe', async () => {
    grants.set('g1', live(['capture']));
    expect((await POST(req({ cookie: `${SESSION_COOKIE}=g1.forged` }))).status).toBe(401);
  });

  it('the shared faculty password still works', async () => {
    const auth = 'Basic ' + Buffer.from('faculty:pw').toString('base64');
    expect((await POST(req({ authorization: auth }))).status).toBe(200);
  });
});
