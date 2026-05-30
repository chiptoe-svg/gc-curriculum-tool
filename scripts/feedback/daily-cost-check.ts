/**
 * Print today's cumulative AI spend in 1/100-cent units. Cron wrapper compares
 * against DAILY_COST_CAP_USD * 10000 to decide whether to dispatch.
 *
 * Run via: `pnpm exec tsx --env-file=.env.local scripts/feedback/daily-cost-check.ts`
 * Outputs a single integer on stdout (today's spend, in 1/100-cent units).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

async function main() {
  // `day` is stored as TEXT in 'YYYY-MM-DD' UTC format (see lib/db/schema.ts).
  // Compare to TO_CHAR(CURRENT_DATE) rather than CURRENT_DATE directly to avoid
  // the text/date operator mismatch.
  const result = await db.execute(sql`
    SELECT COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost
    WHERE day = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
    LIMIT 1
  `);
  const row = result.rows[0] as { spent?: number | string } | undefined;
  const spent = row?.spent ? Number(row.spent) : 0;
  process.stdout.write(String(spent));
}

main().catch(err => { console.error(err); process.exit(1); });
