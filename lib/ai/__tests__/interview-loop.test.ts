// @vitest-environment node
/** Pi plan Task 5: the interview loop setting (current or Pi), default current. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => ({ value: [] as Array<{ loop: string | null }>, fail: false }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (rows.fail) throw new Error('column "loop" does not exist'); return rows.value; } }) }) }),
  },
}));

import { resolveInterviewLoop, invalidateSettingsCache } from '@/lib/ai/function-settings';

describe('resolveInterviewLoop', () => {
  beforeEach(() => { rows.value = []; rows.fail = false; invalidateSettingsCache(); });

  it('default loop is current', async () => {
    expect(await resolveInterviewLoop()).toBe('current');
  });

  it('pi setting routes the interview to the Pi loop', async () => {
    rows.value = [{ loop: 'pi' }];
    expect(await resolveInterviewLoop()).toBe('pi');
  });

  it('a database without the column (migration not applied) keeps the current loop', async () => {
    rows.fail = true;
    expect(await resolveInterviewLoop()).toBe('current');
  });
});
