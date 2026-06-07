import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureConversations } from '@/lib/db/schema';
import type { CaptureReadiness } from '@/lib/ai/capture/schema';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CaptureConversationRow {
  courseCode: string;
  messages: ChatMessage[];
  readiness: CaptureReadiness | null;
  updatedAt: Date;
}

export async function getCaptureConversation(courseCode: string): Promise<CaptureConversationRow | null> {
  const rows = await db
    .select()
    .from(captureConversations)
    .where(eq(captureConversations.courseCode, courseCode))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    courseCode: row.courseCode,
    messages: row.messages ?? [],
    readiness: row.readiness ?? null,
    updatedAt: row.updatedAt,
  };
}

export interface UpsertCaptureConversationInput {
  courseCode: string;
  messages: ChatMessage[];
  readiness: CaptureReadiness | null;
}

export async function upsertCaptureConversation({
  courseCode,
  messages,
  readiness,
}: UpsertCaptureConversationInput): Promise<void> {
  const now = new Date();
  // Atomic upsert on the courseCode key — closes the TOCTOU window where two
  // concurrent capture writes both saw no row and both INSERTed (23505 → 500).
  await db
    .insert(captureConversations)
    .values({ courseCode, messages, readiness, updatedAt: now })
    .onConflictDoUpdate({
      target: captureConversations.courseCode,
      set: { messages, readiness, updatedAt: now },
    });
}

export async function deleteCaptureConversation(courseCode: string): Promise<boolean> {
  const rows = await db
    .delete(captureConversations)
    .where(eq(captureConversations.courseCode, courseCode))
    .returning({ courseCode: captureConversations.courseCode });
  return rows.length > 0;
}
