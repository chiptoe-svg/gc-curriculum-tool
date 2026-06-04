import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerCaptureMessages, careerCaptures } from '@/lib/db/schema';

export interface EmployerMessageRow {
  id: string;
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  turnIndex: number;
  role: string;
  content: string | null;
  citations: Array<{ type: 'transcript'; messageId?: string; excerpt: string }> | null;
  createdAt: Date;
}

export interface AppendEmployerMessageInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string | null;
  citations?: EmployerMessageRow['citations'];
}

/**
 * Append one turn to an interview session. Idempotency is enforced by
 * the UNIQUE(session_id, turn_index) index — duplicate inserts throw.
 */
export async function appendEmployerMessage(input: AppendEmployerMessageInput): Promise<void> {
  await db.insert(careerCaptureMessages).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content,
    citations: input.citations ?? null,
  });
}

/**
 * All messages for one interview session, ordered by turn_index ascending.
 * Used to rehydrate the agent on each turn + to feed the full transcript
 * to synthesis.
 */
export async function getEmployerSession(
  partnerId: string,
  careerTargetId: string,
  sessionId: string,
): Promise<EmployerMessageRow[]> {
  const rows = await db
    .select()
    .from(careerCaptureMessages)
    .where(and(
      eq(careerCaptureMessages.partnerId, partnerId),
      eq(careerCaptureMessages.careerTargetId, careerTargetId),
      eq(careerCaptureMessages.sessionId, sessionId),
    ))
    .orderBy(asc(careerCaptureMessages.turnIndex));
  return rows as EmployerMessageRow[];
}

/**
 * Latest open session id for this (partner, target) — i.e., the
 * session_id of the most recent message. Null when no interview has
 * started yet. Used to decide whether to start a new session or
 * resume.
 */
export async function getLatestEmployerSessionId(
  partnerId: string,
  careerTargetId: string,
): Promise<string | null> {
  const rows = await db
    .select({ sessionId: careerCaptureMessages.sessionId })
    .from(careerCaptureMessages)
    .where(and(
      eq(careerCaptureMessages.partnerId, partnerId),
      eq(careerCaptureMessages.careerTargetId, careerTargetId),
    ))
    .orderBy(desc(careerCaptureMessages.createdAt))
    .limit(1);
  return rows[0]?.sessionId ?? null;
}

/** Mint a fresh interview session id. */
export function startEmployerSession(): string {
  return randomUUID();
}

/**
 * Authorization check: does this (partnerId, careerTargetId) own messages
 * under this sessionId? Used by the chat route before trusting a
 * client-supplied sessionId — prevents one partner from appending turns
 * to another partner's session. A brand-new session id (zero rows) is
 * considered owned: minting one client-side and using it on the first
 * turn is the expected flow.
 */
export async function isEmployerSessionOwnedBy(
  sessionId: string,
  partnerId: string,
  careerTargetId: string,
): Promise<boolean> {
  const rows = await db
    .select({ partnerId: careerCaptureMessages.partnerId, careerTargetId: careerCaptureMessages.careerTargetId })
    .from(careerCaptureMessages)
    .where(eq(careerCaptureMessages.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0) return true;
  return rows[0]!.partnerId === partnerId && rows[0]!.careerTargetId === careerTargetId;
}

export interface CreateCareerCaptureInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  profile: unknown;
  model: string;
}

/**
 * Persist a completed interview's synthesis output. Returns the new row.
 * Immutable — subsequent interviews on the same target by the same
 * partner append new rows; the prior row stays as history.
 */
export async function createCareerCapture(input: CreateCareerCaptureInput): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db.insert(careerCaptures).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    sessionId: input.sessionId,
    profile: input.profile as object,
    model: input.model,
  }).returning({ id: careerCaptures.id, createdAt: careerCaptures.createdAt });
  if (!row) throw new Error('createCareerCapture: no row returned');
  return row;
}

/**
 * Latest non-retired CareerCapture row for a given (partner, target).
 * Used by display surfaces (admin synthesis view, future program
 * coverage matrix). Returns null when no interview has produced a
 * capture yet.
 */
export async function getLatestCaptureFor(
  partnerId: string,
  careerTargetId: string,
): Promise<{ id: string; profile: unknown; createdAt: Date } | null> {
  const [row] = await db
    .select({
      id: careerCaptures.id,
      profile: careerCaptures.profile,
      createdAt: careerCaptures.createdAt,
    })
    .from(careerCaptures)
    .where(and(
      eq(careerCaptures.partnerId, partnerId),
      eq(careerCaptures.careerTargetId, careerTargetId),
      isNull(careerCaptures.retiredAt),
    ))
    .orderBy(desc(careerCaptures.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * All non-retired CareerCaptures for one career target, across all
 * partners. Used by the admin synthesis view + the future program
 * coverage matrix to surface "field truth" for this target.
 */
export async function listCapturesByTarget(
  careerTargetId: string,
): Promise<Array<{ id: string; partnerId: string; profile: unknown; createdAt: Date }>> {
  const rows = await db
    .select({
      id: careerCaptures.id,
      partnerId: careerCaptures.partnerId,
      profile: careerCaptures.profile,
      createdAt: careerCaptures.createdAt,
    })
    .from(careerCaptures)
    .where(and(
      eq(careerCaptures.careerTargetId, careerTargetId),
      isNull(careerCaptures.retiredAt),
    ))
    .orderBy(desc(careerCaptures.createdAt));
  return rows;
}
