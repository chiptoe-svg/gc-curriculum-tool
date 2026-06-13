// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent the real node-postgres pool + session module from loading.
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const auth = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');
function reqFor(path: string, opts: { method?: string; cred?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = auth(opts.cred);
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? 'GET', headers });
}

beforeEach(() => {
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
  vi.stubEnv('CREATE_ONLY_AUTH', 'cufaculty:tigers');
});
afterEach(() => vi.unstubAllEnvs());

describe('middleware role enforcement', () => {
  it('401s with no credentials on a faculty path', async () => {
    expect((await middleware(reqFor('/capture/GC%201040'))).status).toBe(401);
  });
  it('lets faculty reach an edit surface', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'gcfaculty:godfrey' }))).status).toBe(200);
  });
  it('403s a creator on an edit surface', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'cufaculty:tigers' }))).status).toBe(403);
  });
  it('403s a creator on /program', async () => {
    expect((await middleware(reqFor('/program', { cred: 'cufaculty:tigers' }))).status).toBe(403);
  });
  it('lets a creator GET the add-course form', async () => {
    expect((await middleware(reqFor('/courses/new', { cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
  it('lets a creator POST the create API', async () => {
    expect((await middleware(reqFor('/api/admin/courses/roster', { method: 'POST', cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
});
