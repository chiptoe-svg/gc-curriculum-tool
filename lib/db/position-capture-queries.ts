import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { positionCaptureMessages, positionCaptures, careerTargetKudAggregate } from '@/lib/db/schema';

export interface PositionCaptureRow {
  id: string;
  partnerId: string;
  careerTargetId: string;
  status: 'draft' | 'submitted';
  company: string;
  positionTitle: string | null;
  structuredInputs: Record<string, unknown> | null;
  ratedSkills: { items: Array<{ name: string; description?: string; sub_competency_id?: string | null; evidence_source?: string; rating: number }>; generatedAt: string } | null;
  sourceFiles: Array<{ kind: string; fileName: string; key: string; extractedText?: string }> | null;
  sessionId: string | null;
  profile: unknown;
  model: string | null;
  completeness: 'title-only' | 'structured' | 'rated' | 'interviewed' | null;
  supersedes: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface CreateDraftInput {
  partnerId: string;
  careerTargetId: string;
  company: string;
  supersedes?: string | null;
}

/**
 * Create a draft position capture for a partner. Returns the new row.
 * `company` is required at creation (it's the partner's company name
 * defaulted from `partners.company`; partner can override on page 1).
 */
export async function createPositionDraft(input: CreateDraftInput): Promise<{ id: string }> {
  const [row] = await db.insert(positionCaptures).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    company: input.company,
    status: 'draft',
    supersedes: input.supersedes ?? null,
  }).returning({ id: positionCaptures.id });
  if (!row) throw new Error('createPositionDraft: no row returned');
  return row;
}

export async function getPositionCaptureById(id: string): Promise<PositionCaptureRow | null> {
  const [row] = await db.select().from(positionCaptures).where(eq(positionCaptures.id, id)).limit(1);
  return (row as PositionCaptureRow | undefined) ?? null;
}

export interface UpdateDraftInput {
  id: string;
  partnerId: string;
  positionTitle?: string;
  structuredInputs?: Record<string, unknown>;
  ratedSkills?: PositionCaptureRow['ratedSkills'];
  sourceFiles?: PositionCaptureRow['sourceFiles'];
  completeness?: PositionCaptureRow['completeness'];
  sessionId?: string;
}

/**
 * Auto-save during the 6-page wizard. Updates only the fields provided.
 * Refuses to update a row that doesn't belong to the partner or isn't
 * in 'draft' status (immutability gate on submitted rows).
 */
export async function updatePositionDraft(input: UpdateDraftInput): Promise<void> {
  const result = await db.update(positionCaptures)
    .set({
      ...(input.positionTitle !== undefined && { positionTitle: input.positionTitle }),
      // Shallow-merge (jsonb ||): each wizard page owns top-level sibling keys, none nests,
      // so a PATCH that omits a key cannot clobber a server-written key (e.g. interview_doc_text).
      ...(input.structuredInputs !== undefined && {
        structuredInputs: sql`coalesce(${positionCaptures.structuredInputs}, '{}'::jsonb) || ${JSON.stringify(input.structuredInputs)}::jsonb`,
      }),
      ...(input.ratedSkills !== undefined && { ratedSkills: input.ratedSkills }),
      ...(input.sourceFiles !== undefined && { sourceFiles: input.sourceFiles }),
      ...(input.completeness !== undefined && { completeness: input.completeness }),
      ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
    })
    .where(and(
      eq(positionCaptures.id, input.id),
      eq(positionCaptures.partnerId, input.partnerId),
      eq(positionCaptures.status, 'draft'),
    ))
    .returning({ id: positionCaptures.id });
  if (result.length === 0) throw new Error(`updatePositionDraft: row ${input.id} not draftable (wrong partner or already submitted)`);
}

export interface FinalizeInput {
  id: string;
  partnerId: string;
  completeness: 'title-only' | 'structured' | 'rated' | 'interviewed';
  profile?: unknown;
  model?: string;
  sessionId?: string;
}

/**
 * Commit a draft to submitted. Sets status='submitted', submittedAt=now,
 * and completeness. If completeness='interviewed' the caller must also
 * supply profile + model + sessionId. Marks the target's aggregate stale.
 */
export async function finalizePosition(input: FinalizeInput): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(positionCaptures)
      .set({
        status: 'submitted',
        completeness: input.completeness,
        profile: input.profile ?? null,
        model: input.model ?? null,
        sessionId: input.sessionId ?? null,
        submittedAt: sql`now()`,
      })
      .where(and(
        eq(positionCaptures.id, input.id),
        eq(positionCaptures.partnerId, input.partnerId),
        eq(positionCaptures.status, 'draft'),
      ))
      .returning({ careerTargetId: positionCaptures.careerTargetId });
    if (updated.length === 0) throw new Error(`finalizePosition: row ${input.id} not draftable`);
    const targetId = updated[0]!.careerTargetId;
    // Upsert stale flag on the target's aggregate
    await tx.insert(careerTargetKudAggregate).values({
      careerTargetId: targetId,
      aggregateMarkdown: '',
      derivedFromPositionIds: [],
      stale: true,
    }).onConflictDoUpdate({
      target: careerTargetKudAggregate.careerTargetId,
      set: { stale: true },
    });
  });
}

/** All position captures (drafts + submitted) belonging to a partner. */
export async function listPositionsByPartner(partnerId: string): Promise<PositionCaptureRow[]> {
  const rows = await db.select().from(positionCaptures)
    .where(eq(positionCaptures.partnerId, partnerId))
    .orderBy(desc(positionCaptures.createdAt));
  return rows as PositionCaptureRow[];
}

/**
 * All submitted, non-superseded position captures for a career target.
 * Used by the aggregate function + the admin synthesis view.
 */
export async function listSubmittedPositionsForTarget(targetId: string): Promise<PositionCaptureRow[]> {
  // "Non-superseded" = no other row has THIS row's id in its supersedes column.
  // Simpler equivalent: rows whose id does not appear in any other row's supersedes.
  const rows = await db.execute(sql`
    SELECT pc.* FROM position_captures pc
    WHERE pc.career_target_id = ${targetId}
      AND pc.status = 'submitted'
      AND pc.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM position_captures sup
        WHERE sup.supersedes = pc.id
      )
    ORDER BY pc.submitted_at DESC NULLS LAST, pc.created_at DESC
  `);
  return rows.rows as unknown as PositionCaptureRow[];
}

// ---------- messages (page 6 interview transcript) ----------

export interface PositionMessageRow {
  id: string;
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  turnIndex: number;
  role: string;
  content: string | null;
  citations: Array<{ type: 'transcript' | 'page-input'; messageId?: string; pageRef?: string; excerpt: string }> | null;
  createdAt: Date;
}

export interface AppendPositionMessageInput {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string | null;
  citations?: PositionMessageRow['citations'];
}

export async function appendPositionMessage(input: AppendPositionMessageInput): Promise<void> {
  await db.insert(positionCaptureMessages).values({
    partnerId: input.partnerId,
    positionCaptureId: input.positionCaptureId,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content,
    citations: input.citations ?? null,
  });
}

export async function getPositionSession(
  positionCaptureId: string,
  sessionId: string,
): Promise<PositionMessageRow[]> {
  const rows = await db.select().from(positionCaptureMessages)
    .where(and(
      eq(positionCaptureMessages.positionCaptureId, positionCaptureId),
      eq(positionCaptureMessages.sessionId, sessionId),
    ))
    .orderBy(asc(positionCaptureMessages.turnIndex));
  return rows as PositionMessageRow[];
}

export function startPositionSession(): string {
  return randomUUID();
}

/**
 * IDOR guard: a brand-new session id (zero rows) is considered owned by
 * the requesting partner; otherwise the first row's (partnerId, positionCaptureId)
 * must match.
 */
export async function isPositionSessionOwnedBy(
  sessionId: string,
  partnerId: string,
  positionCaptureId: string,
): Promise<boolean> {
  const rows = await db.select({
    partnerId: positionCaptureMessages.partnerId,
    positionCaptureId: positionCaptureMessages.positionCaptureId,
  })
    .from(positionCaptureMessages)
    .where(eq(positionCaptureMessages.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0) return true;
  return rows[0]!.partnerId === partnerId && rows[0]!.positionCaptureId === positionCaptureId;
}

// ---------- aggregate ----------

export async function getAggregateForTarget(targetId: string): Promise<{
  markdown: string;
  derivedFromPositionIds: string[];
  stale: boolean;
  generatedAt: Date;
} | null> {
  const [row] = await db.select().from(careerTargetKudAggregate)
    .where(eq(careerTargetKudAggregate.careerTargetId, targetId))
    .limit(1);
  if (!row) return null;
  return {
    markdown: row.aggregateMarkdown,
    derivedFromPositionIds: row.derivedFromPositionIds,
    stale: row.stale,
    generatedAt: row.generatedAt,
  };
}

export async function writeAggregateForTarget(input: {
  targetId: string;
  markdown: string;
  derivedFromPositionIds: string[];
}): Promise<void> {
  await db.insert(careerTargetKudAggregate).values({
    careerTargetId: input.targetId,
    aggregateMarkdown: input.markdown,
    derivedFromPositionIds: input.derivedFromPositionIds,
    stale: false,
    generatedAt: sql`now()` as unknown as Date,
  }).onConflictDoUpdate({
    target: careerTargetKudAggregate.careerTargetId,
    set: {
      aggregateMarkdown: input.markdown,
      derivedFromPositionIds: input.derivedFromPositionIds,
      stale: false,
      generatedAt: sql`now()` as unknown as Date,
    },
  });
}
