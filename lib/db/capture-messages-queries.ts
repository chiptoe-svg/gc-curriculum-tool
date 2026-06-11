/**
 * Append-only conversation log keyed by session. Replaces the
 * session-overwriting behavior of capture_conversations. See the v2
 * agentic-retrieval spec for the data model rationale:
 * docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md
 *
 * A session_id groups all messages from one audit attempt. Snapshots
 * link to the producing session via course_capture_snapshots.transcript_session_id.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureMessages } from '@/lib/db/schema';
import { parseAssistantContent, type ParsedAssistantTurn } from '@/lib/ai/agent/session-briefing';

export type CaptureMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface CaptureMessageToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface CaptureMessageToolResult {
  toolCallId: string;
  result: unknown;
}

export interface CaptureMessageCitation {
  type: 'chunk' | 'instructor';
  chunkId?: string;
  messageId?: string;
  excerpt: string;
}

export interface AppendMessageInput {
  courseCode: string;
  sessionId: string;
  turnIndex: number;
  role: CaptureMessageRole;
  content?: string | null;
  toolCalls?: CaptureMessageToolCall[];
  toolResult?: CaptureMessageToolResult[];  // plural array per Task 1 fix
  citations?: CaptureMessageCitation[];
  /**
   * Auditor identity for this session. Set on every row of a session so
   * resumes preserve the identity even if early rows are pruned, and so
   * snapshots created from the session can inherit instructor_name
   * trivially via a "pick any message from session" lookup.
   */
  instructorName?: string | null;
}

/**
 * Mint a fresh session id. Caller persists it on the client (cookie / URL
 * state) and passes it back on subsequent turns to keep them grouped.
 */
export function startNewSession(): string {
  return randomUUID();
}

/**
 * Append one message to the session log. Idempotency is the caller's
 * responsibility (use a deterministic id if you need it).
 */
export async function appendMessage(input: AppendMessageInput): Promise<void> {
  await db.insert(captureMessages).values({
    courseCode: input.courseCode,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content ?? null,
    toolCalls: input.toolCalls ?? null,
    toolResult: input.toolResult ?? null,
    citations: input.citations ?? null,
    instructorName: input.instructorName ?? null,
  });
}

/**
 * Returns the instructor_name stamped on the MOST RECENT message of this
 * session, or null if no message had an instructor stamped. Used by
 * snapshot creation to inherit the auditor identity from the session
 * that produced the snapshot.
 *
 * Most-recent-wins (not first-wins) so that mid-session identity changes
 * — e.g., a faculty member opens an audit started under "Department
 * canonical" and asserts ownership — propagate cleanly to the snapshot.
 * Earlier rows keep their original stamp (the transcript stays honest
 * about who actually typed each turn); only the snapshot picks up the
 * "who's wrapping up" identity.
 */
export async function getSessionInstructor(
  courseCode: string,
  sessionId: string,
): Promise<string | null> {
  // Most-recent-wins: the latest turn that carries a stamped instructor. Query
  // for it directly (NOT NULL filter + LIMIT 1) so a long session can't push
  // the stamp past a fixed row cap.
  const rows = await db
    .select({ instructorName: captureMessages.instructorName })
    .from(captureMessages)
    .where(and(
      eq(captureMessages.courseCode, courseCode),
      eq(captureMessages.sessionId, sessionId),
      isNotNull(captureMessages.instructorName),
    ))
    .orderBy(desc(captureMessages.turnIndex))
    .limit(1);
  return rows[0]?.instructorName ?? null;
}

/**
 * Return all messages for a session, ordered by turn_index ascending.
 * Used by the audit chat to rehydrate context and by the Review panel
 * to render the full transcript for snapshot review.
 *
 * **Stage 3 rehydration note for tool-role rows:** the `toolResult` column is
 * an array (`Array<{ toolCallId, result }>`) because one assistant turn can
 * produce multiple tool calls that resolve to multiple results in one logical
 * "tool turn." When rehydrating these rows into the `Message[]` shape that the
 * agent loop expects (where `role: 'tool'` is a flat single-result entry),
 * callers must EXPAND each tool-role row into one `Message` per array element.
 * Without this expansion, only the first result will surface in the model's
 * context and the rest will be silently dropped.
 */
export async function getSessionMessages(courseCode: string, sessionId: string) {
  return db
    .select()
    .from(captureMessages)
    .where(and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.sessionId, sessionId)))
    .orderBy(asc(captureMessages.turnIndex));
}

/**
 * Latest session_id for a course in capture_messages, or null when no
 * v2 audit has been started yet. Used by the synthesis route to find
 * the transcript that produced the current draft profile.
 */
export async function getLatestSessionId(courseCode: string): Promise<string | null> {
  const rows = await db
    .select({ sessionId: captureMessages.sessionId })
    .from(captureMessages)
    .where(eq(captureMessages.courseCode, courseCode))
    .orderBy(desc(captureMessages.createdAt))
    .limit(1);
  return rows[0]?.sessionId ?? null;
}

/**
 * Summary of one prior audit session for a course. Used to give a new
 * session's agent enough continuity ("here's where the last audit left
 * off") without burning context on every prior turn verbatim.
 */
export interface PriorSessionSummary {
  sessionId: string;
  startedAt: Date;
  turnCount: number;
  /** Parsed assistant turns in chronological order (turnIndex asc). Drives the structured session briefing. */
  assistantTurns: ParsedAssistantTurn[];
  /** The most recent faculty (user) message body for this session, raw. null if the session has no faculty turns. */
  lastFacultyTurn: string | null;
}

/**
 * For each session in this course OTHER than `excludeSessionId`, return a
 * concise summary. Only sessions with at least one assistant turn count
 * (a session that consists solely of a stray user message isn't useful
 * continuity). Most-recent first; capped at `limit` (default 3) so the
 * agent's at-rest context stays bounded.
 */
/**
 * Lookup one message by id, scoped to a course. The session_id is not
 * required by the storage layer but the route enforces it to keep messages
 * from different sessions from leaking across the slug boundary.
 *
 * The synthesis prompt emits truncated (8-char) message ids in
 * `citations[].messageId` for readability, while the DB stores the full
 * UUID. Try the exact UUID match first (cheap); fall back to a prefix
 * match cast to text when the input isn't a full UUID. Postgres will
 * reject `id = 'short'` with a type error otherwise.
 */
export async function getMessageById(
  courseCode: string,
  messageId: string,
): Promise<{ id: string; sessionId: string; turnIndex: number; role: string; content: string | null } | null> {
  const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
  let whereClause;
  if (isFullUuid) {
    whereClause = and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.id, messageId));
  } else {
    // Prefix-lookup path. Refuse short prefixes (would enumerate) and
    // refuse anything that isn't the 8-char hex shape the synthesis
    // prompt emits — keeps the input domain narrow and rejects LIKE
    // metacharacters by construction.
    if (!/^[0-9a-f]{8}$/i.test(messageId)) return null;
    whereClause = and(
      eq(captureMessages.courseCode, courseCode),
      sql`${captureMessages.id}::text LIKE ${messageId + '%'}`,
    );
  }
  const rows = await db
    .select({
      id: captureMessages.id,
      sessionId: captureMessages.sessionId,
      turnIndex: captureMessages.turnIndex,
      role: captureMessages.role,
      content: captureMessages.content,
    })
    .from(captureMessages)
    .where(whereClause)
    .limit(2);
  // If the prefix matched more than one row, we can't safely resolve it —
  // return null and let the caller surface "not found" rather than picking
  // a random match.
  if (rows.length !== 1) return null;
  return rows[0] ?? null;
}

export async function listPriorSessionSummaries(
  courseCode: string,
  excludeSessionId: string,
  limit: number = 3,
): Promise<PriorSessionSummary[]> {
  // Get all sessions for the course, newest first. `session_id` is a uuid
  // column, so comparing it against an empty string — which is exactly what
  // the capture page passes when there is no in-flight session
  // (`currentSessionId ?? ''`) — throws Postgres "invalid input syntax for
  // type uuid: \"\"" and crashes the page. When there's no session to exclude,
  // filter by course alone (there are no prior sessions to drop anyway).
  const whereClause = excludeSessionId
    ? and(eq(captureMessages.courseCode, courseCode), ne(captureMessages.sessionId, excludeSessionId))
    : eq(captureMessages.courseCode, courseCode);
  const rows = await db
    .select()
    .from(captureMessages)
    .where(whereClause)
    .orderBy(desc(captureMessages.createdAt));

  if (rows.length === 0) return [];

  // Group by session id, preserving order (newest session first by createdAt).
  const bySession = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = bySession.get(r.sessionId) ?? [];
    arr.push(r);
    bySession.set(r.sessionId, arr);
  }

  const summaries: PriorSessionSummary[] = [];
  for (const [sessionId, sessionRows] of bySession) {
    // sessionRows are desc by createdAt; sort asc by turnIndex for sanity.
    sessionRows.sort((a, b) => a.turnIndex - b.turnIndex);

    // parseAssistantContent returns null for non-JSON / no-signal rows; those are intentionally skipped.
    const assistantTurns: ParsedAssistantTurn[] = sessionRows
      .filter(r => r.role === 'assistant')
      .map(r => parseAssistantContent(typeof r.content === 'string' ? r.content : null))
      .filter((t): t is ParsedAssistantTurn => t !== null);

    // Tightens the prior `if (!lastAssistant) continue` guard: a session counts as
    // useful continuity only if it has at least one PARSEABLE assistant turn (intentional).
    if (assistantTurns.length === 0) continue;

    const lastFacultyRow = [...sessionRows].reverse().find(r => r.role === 'user');
    const lastFacultyTurn =
      lastFacultyRow && typeof lastFacultyRow.content === 'string' && lastFacultyRow.content.length > 0
        ? lastFacultyRow.content
        : null;

    summaries.push({
      sessionId,
      startedAt: sessionRows[0]!.createdAt,
      turnCount: sessionRows.length,
      assistantTurns,
      lastFacultyTurn,
    });
    if (summaries.length >= limit) break;
  }
  return summaries;
}
