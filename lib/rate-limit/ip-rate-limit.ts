import { db } from '@/lib/db/client';
import { ipHourly } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const MAX_PER_HOUR = 10;

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
