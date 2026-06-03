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
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureMessages } from '@/lib/db/schema';

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
  const rows = await db
    .select({ instructorName: captureMessages.instructorName })
    .from(captureMessages)
    .where(and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.sessionId, sessionId)))
    .orderBy(desc(captureMessages.turnIndex))
    .limit(50);
  for (const r of rows) {
    if (r.instructorName) return r.instructorName;
  }
  return null;
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
  lastAssistantContent: string | null;
  lastAssistantReadiness: unknown | null;
  turnCount: number;
  /**
   * The last ~8 user/assistant turns (chronological), each content
   * truncated to ~1500 chars. Persists conversational memory across
   * sessions so the next-session agent doesn't ask faculty questions
   * faculty has already answered.
   */
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
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
  const whereClause = isFullUuid
    ? and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.id, messageId))
    : and(
        eq(captureMessages.courseCode, courseCode),
        sql`${captureMessages.id}::text LIKE ${messageId + '%'}`,
      );
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
  // Get all sessions for the course, newest first.
  const rows = await db
    .select()
    .from(captureMessages)
    .where(and(eq(captureMessages.courseCode, courseCode), ne(captureMessages.sessionId, excludeSessionId)))
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
    const lastAssistant = [...sessionRows].reverse().find(r => r.role === 'assistant');
    if (!lastAssistant) continue; // session has no assistant turns
    let readiness: unknown = null;
    let assistantText: string | null = null;
    if (typeof lastAssistant.content === 'string' && lastAssistant.content.length > 0) {
      try {
        const parsed = JSON.parse(lastAssistant.content) as Record<string, unknown>;
        readiness = parsed.readiness ?? null;
        const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
        const question = typeof parsed.question === 'string' ? parsed.question : '';
        assistantText = [finding, question].filter(Boolean).join(' / ') || lastAssistant.content;
      } catch {
        // Not JSON — treat the whole content as the message body.
        assistantText = lastAssistant.content;
      }
    }
    // Collect the last 8 user/assistant turns (chronological) so the next
    // session's agent can see what faculty actually said, not just the
    // agent's own last summary. Tool turns are skipped — they're internal
    // retrieval noise, not conversation memory.
    const RECENT_TURNS_CAP = 8;
    const PER_TURN_CHAR_CAP = 1500;
    const conversational = sessionRows.filter(r => r.role === 'user' || r.role === 'assistant');
    const tail = conversational.slice(-RECENT_TURNS_CAP);
    const recentTurns = tail.map(r => {
      let content = typeof r.content === 'string' ? r.content : '';
      // Assistant turns are stored as JSON ({finding, question, ...});
      // unwrap to the readable prose so the next session sees what the
      // user would've seen, not raw JSON.
      if (r.role === 'assistant' && content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content) as { finding?: string; question?: string };
          content = [parsed.finding, parsed.question].filter(Boolean).join('\n\n') || content;
        } catch {
          // leave raw if parse fails
        }
      }
      if (content.length > PER_TURN_CHAR_CAP) {
        content = content.slice(0, PER_TURN_CHAR_CAP) + '…';
      }
      return { role: r.role as 'user' | 'assistant', content };
    });

    summaries.push({
      sessionId,
      startedAt: sessionRows[0]!.createdAt,
      lastAssistantContent: assistantText,
      lastAssistantReadiness: readiness,
      turnCount: sessionRows.length,
      recentTurns,
    });
    if (summaries.length >= limit) break;
  }
  return summaries;
}
