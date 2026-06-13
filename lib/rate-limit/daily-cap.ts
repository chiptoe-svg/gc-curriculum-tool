import { db } from '@/lib/db/client';
import { dailyCost } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

/**
 * Any single recordSpend above $10,000 (1_000_000_000 in 1/100-cent units) is
 * a bug or sentinel, not a real charge — clamp it so a runaway extractor
 * can't poison the accumulator or overflow the bigint column.
 */
export const MAX_SANE_CENTS = 100_000_000; // $10,000 in 1/100-cent units

/**
 * Sanitize a raw cost value before writing to daily_cost.
 * - Non-finite (NaN / ±Infinity) → 0
 * - Negative              → 0
 * - Round to integer      (costs are always whole 1/100-cent units)
 * - Clamp to MAX_SANE_CENTS
 */
export function sanitizeCents(n: number): number {
  if (!isFinite(n)) return 0;
  if (n < 0 || Object.is(n, -0)) return 0;
  const rounded = Math.round(n);
  return rounded > MAX_SANE_CENTS ? MAX_SANE_CENTS : rounded;
}

// Local-date day key — matches Postgres `CURRENT_DATE` (server-local) used by
// getDailyCostHistory, so the cap window resets at LOCAL midnight, not UTC
// midnight (which on the US-East box fell at ~8pm local and split the day).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentDayKey(): string {
  return dayKey(new Date());
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
  // MAKE_INTERVAL accepts a typed integer parameter cleanly. Multiplying a
  // raw bind parameter by INTERVAL '1 day' trips Postgres's type inference
  // because the parameter could be any number type and the planner won't
  // pick one.
  const result = await db.execute(sql`
    SELECT day::text AS day, COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost
    WHERE day >= CURRENT_DATE - MAKE_INTERVAL(days => ${days - 1}::int)
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
    d.setDate(d.getDate() - i);
    out.push({ day: dayKey(d), spentCents: byDay.get(dayKey(d)) ?? 0 });
  }
  return out;
}

export async function recordSpend(costCents: number): Promise<void> {
  const safe = sanitizeCents(costCents);
  const day = currentDayKey();
  await db.execute(sql`
    INSERT INTO daily_cost (day, total_cost_usd_cents)
    VALUES (${day}, ${safe})
    ON CONFLICT (day)
    DO UPDATE SET total_cost_usd_cents = daily_cost.total_cost_usd_cents + ${safe}
  `);
}
