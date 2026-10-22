import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/client', () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn('TX'), execute: vi.fn() } }));
vi.mock('@/scripts/catalog/catalog-source', async (orig) => ({
  ...(await orig<typeof import('@/scripts/catalog/catalog-source')>()),
  assertExpectedDb: vi.fn(async (name: string) => { if (name !== 'scratch') throw new Error('wrong database'); }),
}));
import { main } from '@/scripts/catalog/import-ai-weights';

describe('import-ai-weights CLI', () => {
  it('requires --file and --expect-db (exit 2) and refuses the wrong database (exit 1)', async () => {
    expect(await main(['--expect-db', 'scratch'])).toBe(2);
    expect(await main(['--file', 'x.json'])).toBe(2);
    expect(await main(['--file', 'x.json', '--expect-db', 'live'])).toBe(1);
  });

  it('dry run by default: imports with apply false; --apply writes', async () => {
    const run = vi.fn(async () => ({ upserted: 2, changes: [] }));
    const load = vi.fn(async () => ({ model: 'm', ratings: [] }));
    expect(await main(['--file', 'x.json', '--expect-db', 'scratch'], { run, load })).toBe(0);
    expect(run).toHaveBeenLastCalledWith('TX', { model: 'm', ratings: [] }, { apply: false });
    expect(await main(['--file', 'x.json', '--expect-db', 'scratch', '--apply'], { run, load })).toBe(0);
    expect(run).toHaveBeenLastCalledWith('TX', { model: 'm', ratings: [] }, { apply: true });
  });

  it('a file that fails validation exits 1 and imports nothing', async () => {
    const run = vi.fn();
    const load = vi.fn(async () => { throw new Error('missing rating for t / c'); });
    expect(await main(['--file', 'x.json', '--expect-db', 'scratch'], { run, load })).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });
});
