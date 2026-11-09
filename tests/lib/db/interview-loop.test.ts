// Real-DB test: requires DATABASE_URL (a scratch DB, never live). Skips (not
// fails) when unset. Pi plan Task 5: the interview loop setting is stored on
// ai_function_settings.loop (migration 0065) and read back by resolveInterviewLoop.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { aiFunctionSettings } from '@/lib/db/schema';
import { invalidateSettingsCache, resolveInterviewLoop, setInterviewLoop } from '@/lib/ai/function-settings';

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)('interview loop setting', () => {
  let before: Array<{ tier: string; customModel: string | null; loop: string | null }> = [];

  beforeAll(async () => {
    const name = (await db.execute(sql`select current_database() as n`)).rows[0] as { n: string };
    if (!/scratch/.test(name.n)) throw new Error(`refusing to run on ${name.n}`);
    const col = await db.execute(sql`select 1 from information_schema.columns where table_name = 'ai_function_settings' and column_name = 'loop'`);
    if (col.rows.length === 0) await db.execute(sql.raw(readFileSync('drizzle/0065_interview_loop.sql', 'utf8')));
    before = await db.select({ tier: aiFunctionSettings.tier, customModel: aiFunctionSettings.customModel, loop: aiFunctionSettings.loop })
      .from(aiFunctionSettings).where(eq(aiFunctionSettings.functionId, 'capture-chat-agent'));
  });

  afterAll(async () => {
    await db.delete(aiFunctionSettings).where(eq(aiFunctionSettings.functionId, 'capture-chat-agent'));
    if (before[0]) await db.insert(aiFunctionSettings).values({ functionId: 'capture-chat-agent', ...before[0] });
    invalidateSettingsCache();
  });

  it('stores pi and current and reads them back', async () => {
    await setInterviewLoop('pi');
    invalidateSettingsCache();
    expect(await resolveInterviewLoop()).toBe('pi');
    await setInterviewLoop('current');
    invalidateSettingsCache();
    expect(await resolveInterviewLoop()).toBe('current');
  });

  it('rejects any other value at the database', async () => {
    await expect(db.execute(sql`update ai_function_settings set loop = 'codex' where function_id = 'capture-chat-agent'`)).rejects.toThrow();
  });
});
