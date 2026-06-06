import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners, partnerEvents, positionCaptures } from '@/lib/db/schema';
import { generateMagicToken } from './tokens';

export interface CreatePartnerInput {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  roleTitle: string | null;
  weight: number;
  careerTargetHints: string[];
}

export async function createPartner(input: CreatePartnerInput) {
  const token = generateMagicToken();
  const [row] = await db.insert(partners).values({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    roleTitle: input.roleTitle,
    weight: input.weight,
    careerTargetHints: input.careerTargetHints,
    magicToken: token,
  }).returning();
  if (!row) throw new Error('createPartner: insert returned no row');
  return row;
}

export async function findPartnerByEmail(email: string) {
  const rows = await db.select().from(partners).where(eq(partners.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findPartnerByToken(token: string) {
  const rows = await db.select().from(partners).where(eq(partners.magicToken, token)).limit(1);
  return rows[0] ?? null;
}

export async function findPartnerById(id: string) {
  const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listPartners() {
  return db.select().from(partners).orderBy(desc(partners.createdAt));
}

export async function markInvited(id: string) {
  await db.update(partners).set({ invitedAt: sql`now()` }).where(eq(partners.id, id));
}

/**
 * Build the partner-survey magic-link URL from PARTNERS_BASE_URL +
 * the partner's magic_token. PARTNERS_BASE_URL is currently the
 * Vercel deploy URL; flips to the Tailscale Funnel URL in Phase B.
 */
export function magicLinkUrl(partner: { magicToken: string }): string {
  const base = process.env.PARTNERS_BASE_URL?.trim();
  if (!base) throw new Error('PARTNERS_BASE_URL not set');
  return `${base.replace(/\/$/, '')}/partners/${partner.magicToken}`;
}

export async function logPartnerEvent(
  partnerId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(partnerEvents).values({ partnerId, eventType, metadata });
}

export async function markFirstOpenedIfNull(partnerId: string) {
  await db.update(partners)
    .set({ firstOpenedAt: sql`now()`, lastActiveAt: sql`now()` })
    .where(sql`${partners.id} = ${partnerId} AND ${partners.firstOpenedAt} IS NULL`);
}

export async function bumpLastActive(partnerId: string) {
  await db.update(partners).set({ lastActiveAt: sql`now()` }).where(eq(partners.id, partnerId));
}

/**
 * Per-partner counts of position captures by status, for the admin roster.
 * Returns a Map keyed by partnerId; partners with no positions are absent
 * (callers default to {draft: 0, submitted: 0}).
 */
export async function countPositionsByPartner(): Promise<Map<string, { draft: number; submitted: number }>> {
  const rows = await db
    .select({
      partnerId: positionCaptures.partnerId,
      status: positionCaptures.status,
      n: sql<number>`count(*)::int`,
    })
    .from(positionCaptures)
    .groupBy(positionCaptures.partnerId, positionCaptures.status);
  const map = new Map<string, { draft: number; submitted: number }>();
  for (const r of rows) {
    const entry = map.get(r.partnerId) ?? { draft: 0, submitted: 0 };
    if (r.status === 'submitted') entry.submitted = r.n;
    else if (r.status === 'draft') entry.draft = r.n;
    map.set(r.partnerId, entry);
  }
  return map;
}
