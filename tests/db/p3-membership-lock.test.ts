/** Two recomputes serialize on the advisory lock. Scratch only; commits and cleans up its own lock probe. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { lockMembership } from '@/lib/db/membership-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

describe.skipIf(!isP2ScratchDb())('membership lock (scratch)', () => {
  it('a second holder waits until the first commits', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const first = db.transaction(async (tx) => { await lockMembership(tx); order.push('first-locked'); await gate; order.push('first-done'); });
    await new Promise(r => setTimeout(r, 100));
    const second = db.transaction(async (tx) => { await lockMembership(tx); order.push('second-locked'); });
    await new Promise(r => setTimeout(r, 200));
    expect(order).toEqual(['first-locked']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
    void sql;
  });
});
