import { db } from '@/lib/db/client';
import { ipHourly } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

// Per-IP cap across ALL routes that call checkIpRateLimit (chat turns,
// transcribes, snapshots, etc.). The bound exists as an abuse floor — not
// a per-feature throttle. 60/hr was the original conservative value when
// these routes might have been internet-facing; with Basic Auth on the
// funnel and only-faculty access, one engaged audit easily exceeds 60
// (10 chat turns × 2 calls each + 10 mic transcribes + saves). Bumped
// to 600/hr — still catches abuse (~10 calls/minute sustained) but
// doesn't break legitimate audit work. Lower if/when per-faculty auth
// replaces Basic Auth and we have real per-user accountability.
export const MAX_PER_HOUR = 600;

function currentHourKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
}

export async function checkIpRateLimit(ipHash: string): Promise<{ allowed: boolean; remaining: number }> {
  const hourKey = currentHourKey();
  const result = await db.execute(sql`
    INSERT INTO ip_hourly (ip_hash, hour_key, count)
    VALUES (${ipHash}, ${hourKey}, 1)
    ON CONFLICT (ip_hash, hour_key)
    DO UPDATE SET count = ip_hourly.count + 1
    RETURNING count
  `);
  const row = result.rows[0] as { count: number } | undefined;
  const count = row?.count ?? 1;
  return { allowed: count <= MAX_PER_HOUR, remaining: Math.max(0, MAX_PER_HOUR - count) };
}
