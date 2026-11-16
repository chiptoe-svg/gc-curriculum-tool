/**
 * Runs only against the scratch database; skips itself anywhere else so it can never touch live data.
 * The course rows it inserts carry a ZZQ subject no real course uses and are deleted afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('findCourseByTypedCode (scratch database)', () => {
  const n = String(Date.now()).slice(-4);
  const codes = { spaced: `ZZQ  ${n}`, hyphen: `ZZQ-${Number(n) + 1}`, suffix: `ZZQ ${Number(n) + 2}s` };
  let m: typeof import('@/lib/db/course-code-match');
  let dbm: typeof import('@/lib/db/client');
  let schema: typeof import('@/lib/db/schema');
  let orm: typeof import('drizzle-orm');

  beforeAll(async () => {
    m = await import('@/lib/db/course-code-match');
    dbm = await import('@/lib/db/client');
    schema = await import('@/lib/db/schema');
    orm = await import('drizzle-orm');
    await dbm.db.insert(schema.courses).values(Object.values(codes).map(code => ({ code, title: 'test', level: 1, track: 'test' })));
  });
  afterAll(async () => {
    if (dbm) await dbm.db.delete(schema.courses).where(orm.inArray(schema.courses.code, Object.values(codes)));
  });

  it('finds a double-spaced, a hyphenated and a lower-case-suffix code from their typed forms', async () => {
    expect(await m.findCourseByTypedCode(`ZZQ ${n}`)).toEqual({ code: codes.spaced });
    expect(await m.findCourseByTypedCode(`zzq${Number(n) + 1}`)).toEqual({ code: codes.hyphen });
    expect(await m.findCourseByTypedCode(`ZZQ ${Number(n) + 2}S`)).toEqual({ code: codes.suffix });
  });
  it('does not match a different number', async () => {
    expect(await m.findCourseByTypedCode(`ZZQ ${Number(n) + 3}`)).toBeNull();
  });
});
