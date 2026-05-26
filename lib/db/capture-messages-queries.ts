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
import { and, asc, eq } from 'drizzle-orm';
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
