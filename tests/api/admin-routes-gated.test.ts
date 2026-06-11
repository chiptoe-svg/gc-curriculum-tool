import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard (audit F1): every admin route under app/api/admin must
 * enforce the admin second factor (`checkAdminAuth`) in addition to middleware
 * Basic Auth. `checkAdminAuth` accepts an `Authorization: Bearer` token
 * (ADMIN_TOKEN or the slug) or the legacy `?slug=`/body slug, and is itself
 * gated on `isValidSlug` — so the second-factor property is preserved while the
 * secret moves out of the query string. v2-reset is a one-request data-loss
 * endpoint; defense-in-depth here is the whole point. If you add an admin
 * route, gate it — or this test fails.
 */
const ADMIN_DIR = join(process.cwd(), 'app/api/admin');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // skip test dirs
      if (entry === '__tests__') continue;
      out.push(...routeFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

describe('admin routes are auth-gated (F1)', () => {
  const files = routeFiles(ADMIN_DIR);

  it('finds the admin route files', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files.map(f => [f.replace(process.cwd() + '/', ''), f]))(
    '%s calls checkAdminAuth',
    (_label, full) => {
      const src = readFileSync(full, 'utf8');
      expect(src.includes('checkAdminAuth')).toBe(true);
    },
  );
});
