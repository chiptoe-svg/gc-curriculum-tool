/**
 * What-if reads and writes (migration 0066). A what-if is stored apart from
 * the real course: nothing here touches snapshots, the working draft or
 * course materials. Every function takes a last parameter `ex` so a caller
 * (or a test) can run it inside a transaction.
 */
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseWhatIfs, courseWhatIfMessages, courseWhatIfAttachments, subCompetencies } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { KnockOn, OwnerKind, UsageKind, WhatIfEstimate, WhatIfProfile, WhatIfProse } from '@/lib/what-if/types';

export type { WhatIfSkills } from '@/lib/what-if/types';
import type { WhatIfSkills } from '@/lib/what-if/types';
export type WhatIfRow = typeof courseWhatIfs.$inferSelect;
export type WhatIfMessageRow = typeof courseWhatIfMessages.$inferSelect;
export type WhatIfAttachmentRow = typeof courseWhatIfAttachments.$inferSelect;

export async function createWhatIf(
  input: {
    courseCode: string; baseSnapshotId: string; ownerGrantId: string; ownerKind: OwnerKind; authorName: string;
    /** A skills-only what-if saved from a cluster (migration 0070) names itself and carries its skills. */
    title?: string; skills?: WhatIfSkills;
  },
  ex: Tx | typeof db = db,
): Promise<WhatIfRow> {
  const [row] = await ex.insert(courseWhatIfs).values(input).returning();
  return row!;
}

export async function getWhatIf(id: string, ex: Tx | typeof db = db): Promise<WhatIfRow | null> {
  const [row] = await ex.select().from(courseWhatIfs).where(eq(courseWhatIfs.id, id));
  return row ?? null;
}

/** Newest first, with and without a page. */
export async function listWhatIfsForCourse(courseCode: string, ex: Tx | typeof db = db): Promise<WhatIfRow[]> {
  return ex.select().from(courseWhatIfs).where(eq(courseWhatIfs.courseCode, courseCode)).orderBy(desc(courseWhatIfs.createdAt));
}

/** What-ifs anyone can open from /explore/<code>: those with a page and skills-only ones saved from a cluster (as
 * app/explore/[code]/page.tsx lists them; a draft with neither is shown to its owner only and is not counted). */
export async function countWhatIfsByCourse(ex: Tx | typeof db = db): Promise<Map<string, number>> {
  const rows = await ex
    .select({ courseCode: courseWhatIfs.courseCode, n: sql<number>`count(*)::int` })
    .from(courseWhatIfs)
    .where(or(isNotNull(courseWhatIfs.pageCreatedAt), and(isNotNull(courseWhatIfs.skills), isNull(courseWhatIfs.profile))))
    .groupBy(courseWhatIfs.courseCode);
  return new Map(rows.map((r) => [r.courseCode, r.n]));
}

export async function renameWhatIf(id: string, title: string, ex: Tx | typeof db = db): Promise<void> {
  await ex.update(courseWhatIfs).set({ title, updatedAt: new Date() }).where(eq(courseWhatIfs.id, id));
}

/** Replaces any previous page. A null title keeps the existing one. */
export async function saveWhatIfPage(
  id: string,
  page: { title: string | null; summary: string; estimate: WhatIfEstimate; profile: WhatIfProfile; knockOn: KnockOn; prose: WhatIfProse },
  ex: Tx | typeof db = db,
): Promise<void> {
  const now = new Date();
  await ex.update(courseWhatIfs).set({
    ...(page.title === null ? {} : { title: page.title }),
    summary: page.summary,
    estimate: page.estimate,
    profile: page.profile,
    knockOn: page.knockOn,
    prose: page.prose,
    pageCreatedAt: now,
    updatedAt: now,
  }).where(eq(courseWhatIfs.id, id));
}

/** Adds one call's cost and tokens to the running total for its kind, in one statement. */
export async function addWhatIfUsage(
  id: string,
  kind: UsageKind,
  t: { costUsdCents: number; promptTokens: number; completionTokens: number },
  ex: Tx | typeof db = db,
): Promise<void> {
  await ex.execute(sql`
    UPDATE course_what_ifs
    SET usage = jsonb_set(
          usage, ARRAY[${kind}::text],
          jsonb_build_object(
            'calls', COALESCE((usage->${kind}->>'calls')::int, 0) + 1,
            'costUsdCents', COALESCE((usage->${kind}->>'costUsdCents')::numeric, 0) + ${t.costUsdCents}::numeric,
            'promptTokens', COALESCE((usage->${kind}->>'promptTokens')::numeric, 0) + ${t.promptTokens}::numeric,
            'completionTokens', COALESCE((usage->${kind}->>'completionTokens')::numeric, 0) + ${t.completionTokens}::numeric
          ),
          true),
        updated_at = now()
    WHERE id = ${id}`);
}

/** Deletes the what-if (messages and attachments cascade); returns the attachment rows so the caller can remove files. */
export async function deleteWhatIf(id: string, ex: Tx | typeof db = db): Promise<WhatIfAttachmentRow[]> {
  const attachments = await listWhatIfAttachments(id, ex);
  await ex.delete(courseWhatIfs).where(eq(courseWhatIfs.id, id));
  return attachments;
}

export async function appendWhatIfMessage(
  whatIfId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: Record<string, unknown>,
  ex: Tx | typeof db = db,
): Promise<WhatIfMessageRow> {
  const [row] = await ex.insert(courseWhatIfMessages).values({
    whatIfId, role, content, meta: meta ?? null,
    createdAt: sql`clock_timestamp()`, // not now(): rows written in one transaction must keep their order
  }).returning();
  return row!;
}

/** Oldest first. */
export async function listWhatIfMessages(whatIfId: string, ex: Tx | typeof db = db): Promise<WhatIfMessageRow[]> {
  return ex.select().from(courseWhatIfMessages).where(eq(courseWhatIfMessages.whatIfId, whatIfId))
    .orderBy(asc(courseWhatIfMessages.createdAt), asc(courseWhatIfMessages.id));
}

export async function insertWhatIfAttachment(
  row: Omit<WhatIfAttachmentRow, 'id' | 'createdAt'>,
  ex: Tx | typeof db = db,
): Promise<WhatIfAttachmentRow> {
  const [created] = await ex.insert(courseWhatIfAttachments).values({
    ...row,
    createdAt: sql`clock_timestamp()`, // not now(): rows written in one transaction must keep their order
  }).returning();
  return created!;
}

export async function listWhatIfAttachments(whatIfId: string, ex: Tx | typeof db = db): Promise<WhatIfAttachmentRow[]> {
  return ex.select().from(courseWhatIfAttachments).where(eq(courseWhatIfAttachments.whatIfId, whatIfId))
    .orderBy(asc(courseWhatIfAttachments.createdAt), asc(courseWhatIfAttachments.id));
}

export async function listActiveSubCompetencies(ex: Tx | typeof db = db): Promise<Array<{ id: string; name: string }>> {
  return ex.select({ id: subCompetencies.id, name: subCompetencies.name }).from(subCompetencies)
    .where(eq(subCompetencies.retired, false)).orderBy(asc(subCompetencies.name));
}
