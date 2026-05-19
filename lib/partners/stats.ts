import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSubmissions } from '@/lib/db/schema';

export interface PartnerStats {
  drafts: number;
  submitted: number;
  ratingsCount: number;
}

/**
 * Counts the partner's submissions by status. `ratingsCount` stays 0 until
 * the project-rating tables land in Plan 2; the field is here so the
 * dashboard contract doesn't change when ratings ship.
 */
export async function getPartnerStats(partnerId: string): Promise<PartnerStats> {
  const rows = await db.select({
    status: partnerSubmissions.status,
    n: sql<number>`count(*)::int`,
  })
    .from(partnerSubmissions)
    .where(eq(partnerSubmissions.partnerId, partnerId))
    .groupBy(partnerSubmissions.status);

  let drafts = 0, submitted = 0;
  for (const r of rows) {
    if (r.status === 'draft') drafts = r.n;
    else if (r.status === 'submitted') submitted = r.n;
  }
  return { drafts, submitted, ratingsCount: 0 };
}
