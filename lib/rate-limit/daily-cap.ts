import { db } from '@/lib/db/client';
import { dailyCost } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

function currentDayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function capCents(): number {
  const usd = Number(process.env.DAILY_COST_CAP_USD ?? '5');
  return Math.floor(usd * 100 * 100);     // dollars → cents → 1/100 of a cent
}

export async function checkDailyCap(): Promise<{ ok: boolean; spentCents: number }> {
  const day = currentDayKey();
  const result = await db.execute(sql`
    SELECT COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost WHERE day = ${day}
  `);
  const spent = (result.rows[0] as { spent: number } | undefined)?.spent ?? 0;
  return { ok: spent < capCents(), spentCents: spent };
}

export async function recordSpend(costCents: number): Promise<void> {
  const day = currentDayKey();
  await db.execute(sql`
    INSERT INTO daily_cost (day, total_cost_usd_cents)
    VALUES (${day}, ${costCents})
    ON CONFLICT (day)
    DO UPDATE SET total_cost_usd_cents = daily_cost.total_cost_usd_cents + ${costCents}
  `);
}
