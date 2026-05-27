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
import { and, asc, desc, eq, ne } from 'drizzle-orm';
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
  });
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
}

/**
 * For each session in this course OTHER than `excludeSessionId`, return a
 * concise summary. Only sessions with at least one assistant turn count
 * (a session that consists solely of a stray user message isn't useful
 * continuity). Most-recent first; capped at `limit` (default 3) so the
 * agent's at-rest context stays bounded.
 */
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
    summaries.push({
      sessionId,
      startedAt: sessionRows[0]!.createdAt,
      lastAssistantContent: assistantText,
      lastAssistantReadiness: readiness,
      turnCount: sessionRows.length,
    });
    if (summaries.length >= limit) break;
  }
  return summaries;
}
