export interface PartnerStats {
  drafts: number;
  submitted: number;
  ratingsCount: number;
}

/**
 * Returns the partner's activity counts. Stubbed to zeros in this task so the
 * dashboard contract is stable; Task 14 upgrades the implementation to query
 * partner_submissions once the table exists.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getPartnerStats(_partnerId: string): Promise<PartnerStats> {
  return { drafts: 0, submitted: 0, ratingsCount: 0 };
}
