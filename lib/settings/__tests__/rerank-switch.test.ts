import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }>, fail: false, reads: 0 }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          state.reads++;
          if (state.fail) throw new Error('db down');
          return state.rows.filter(r => r.key === 'search.rerank');
        },
      }),
    }),
    insert: () => ({
      values: (v: { key: string; value: string }) => ({
        onConflictDoUpdate: async () => {
          state.rows = [...state.rows.filter(r => r.key !== v.key), { key: v.key, value: v.value }];
        },
      }),
    }),
    delete: () => ({ where: async () => { state.rows = state.rows.filter(r => r.key !== 'search.rerank'); } }),
  },
}));

import { getRerankOverride, setRerankOverride, rerankEnabledNow, clearSearchSettingsCache } from '@/lib/settings/app-settings';

describe('reranker switch', () => {
  beforeEach(() => { state.rows = []; state.fail = false; state.reads = 0; clearSearchSettingsCache(); delete process.env.RERANK; });
  afterEach(() => { delete process.env.RERANK; });

  it('no override: follows the env switch (on unless RERANK=off)', async () => {
    expect(await getRerankOverride()).toBeNull();
    expect(await rerankEnabledNow()).toBe(true);
    clearSearchSettingsCache();
    process.env.RERANK = 'off';
    expect(await rerankEnabledNow()).toBe(false);
  });

  it('an override wins over the env', async () => {
    process.env.RERANK = 'off';
    await setRerankOverride('on');
    expect(await getRerankOverride()).toBe('on');
    expect(await rerankEnabledNow()).toBe(true);
    await setRerankOverride('off');
    expect(await rerankEnabledNow()).toBe(false);
    await setRerankOverride(null);
    expect(await rerankEnabledNow()).toBe(false); // env says off
  });

  it('a database failure falls back to the env switch', async () => {
    state.fail = true;
    expect(await rerankEnabledNow()).toBe(true);
    clearSearchSettingsCache();
    process.env.RERANK = 'off';
    expect(await rerankEnabledNow()).toBe(false);
  });

  it('caches the read for searches in a burst', async () => {
    await rerankEnabledNow();
    await rerankEnabledNow();
    expect(state.reads).toBe(1);
  });

  it('ignores a stored value that is not on/off', async () => {
    state.rows = [{ key: 'search.rerank', value: 'maybe' }];
    expect(await getRerankOverride()).toBeNull();
  });
});
