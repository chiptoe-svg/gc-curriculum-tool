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

/** Exposed for the /settings cost widget. Returns the cap in 1/100-of-a-cent units. */
export function getDailyCapCents(): number {
  return capCents();
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

export interface DailyCostRow {
  day: string;   // YYYY-MM-DD (UTC)
  spentCents: number; // 1/100 of a cent units, same as recordSpend
}

/**
 * Returns the last N days of AI spend (ordered ASC by day, including today
 * and any zero-spend days within the window). Missing rows are returned as
 * spentCents: 0 so a UI chart can render a continuous timeline without
 * needing client-side gap-filling.
 */
export async function getDailyCostHistory(days: number = 7): Promise<DailyCostRow[]> {
  const result = await db.execute(sql`
    SELECT day::text AS day, COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost
    WHERE day >= CURRENT_DATE - (${days - 1} * INTERVAL '1 day')
    ORDER BY day ASC
  `);
  const byDay = new Map<string, number>();
  for (const row of result.rows as Array<{ day: string; spent: number }>) {
    byDay.set(row.day, row.spent);
  }
  // Fill missing days with zero so the UI gets a continuous window.
  const out: DailyCostRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({ day: key, spentCents: byDay.get(key) ?? 0 });
  }
  return out;
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
