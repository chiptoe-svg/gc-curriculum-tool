import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners, partnerEvents } from '@/lib/db/schema';
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

export async function logPartnerEvent(
  partnerId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(partnerEvents).values({ partnerId, eventType, metadata });
}
