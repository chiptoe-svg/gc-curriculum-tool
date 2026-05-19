import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSubmissions } from '@/lib/db/schema';

export type SubmissionRow = typeof partnerSubmissions.$inferSelect;

export interface DraftPatch {
  careerTargetId?: string | null;
  unmappedTargetLabel?: string | null;
  positionTitle?: string;
  responsibilities?: string;
  salaryRangeLow?: number | null;
  salaryRangeHigh?: number | null;
  salaryCurrency?: string;
  interviewQuestions?: string[];
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  additionalNotes?: string;
}

export async function listSubmissions(partnerId: string) {
  return db.select().from(partnerSubmissions)
    .where(eq(partnerSubmissions.partnerId, partnerId))
    .orderBy(desc(partnerSubmissions.updatedAt));
}

export async function findSubmission(partnerId: string, id: string) {
  const rows = await db.select().from(partnerSubmissions)
    .where(and(eq(partnerSubmissions.partnerId, partnerId), eq(partnerSubmissions.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createDraft(partnerId: string, patch: DraftPatch) {
  if (!patch.positionTitle) throw new Error('positionTitle required to create');
  const [row] = await db.insert(partnerSubmissions).values({
    partnerId,
    careerTargetId: patch.careerTargetId ?? null,
    unmappedTargetLabel: patch.unmappedTargetLabel ?? null,
    positionTitle: patch.positionTitle,
    responsibilities: patch.responsibilities ?? '',
    salaryRangeLow: patch.salaryRangeLow ?? null,
    salaryRangeHigh: patch.salaryRangeHigh ?? null,
    salaryCurrency: patch.salaryCurrency ?? 'USD',
    interviewQuestions: patch.interviewQuestions ?? [],
    requiredSkills: patch.requiredSkills ?? [],
    niceToHaveSkills: patch.niceToHaveSkills ?? [],
    additionalNotes: patch.additionalNotes ?? '',
    status: 'draft',
  }).returning();
  if (!row) throw new Error('createDraft: insert returned no row');
  return row;
}

export async function updateDraft(partnerId: string, id: string, patch: DraftPatch) {
  const [row] = await db.update(partnerSubmissions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(
      eq(partnerSubmissions.partnerId, partnerId),
      eq(partnerSubmissions.id, id),
      eq(partnerSubmissions.status, 'draft'),
    ))
    .returning();
  return row ?? null;
}

export async function submitDraft(partnerId: string, id: string) {
  const [row] = await db.update(partnerSubmissions)
    .set({ status: 'submitted', submittedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(partnerSubmissions.partnerId, partnerId),
      eq(partnerSubmissions.id, id),
      eq(partnerSubmissions.status, 'draft'),
    ))
    .returning();
  return row ?? null;
}

export async function deleteSubmission(partnerId: string, id: string) {
  const rows = await db.delete(partnerSubmissions)
    .where(and(eq(partnerSubmissions.partnerId, partnerId), eq(partnerSubmissions.id, id)))
    .returning({ id: partnerSubmissions.id });
  return rows.length > 0;
}
