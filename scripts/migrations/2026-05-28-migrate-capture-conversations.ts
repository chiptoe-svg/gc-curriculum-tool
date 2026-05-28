/**
 * One-off backfill: for every row in capture_conversations that hasn't
 * already been mirrored into capture_messages, synthesize a session_id,
 * insert one message per turn, and (if the course has a snapshot whose
 * transcript_session_id is null) link the latest snapshot to that synthetic
 * session.
 *
 * Idempotency: we check whether the course already has any capture_messages
 * rows. If it does (e.g., GC 4800 was mirrored in Stage 1), we skip.
 *
 * Run via: `pnpm dotenv -e .env.local -- tsx scripts/_one-off/2026-05-28-migrate-capture-conversations.ts`
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureConversations, captureMessages, courseCaptureSnapshots } from '@/lib/db/schema';

async function main() {
  const rows = await db.select().from(captureConversations);
  console.log(`Found ${rows.length} capture_conversations rows.`);

  for (const row of rows) {
    const existing = await db
      .select({ id: captureMessages.id })
      .from(captureMessages)
      .where(eq(captureMessages.courseCode, row.courseCode))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[skip] ${row.courseCode} already has capture_messages rows.`);
      continue;
    }

    const messages = Array.isArray(row.messages) ? row.messages : [];
    if (messages.length === 0) {
      console.log(`[skip] ${row.courseCode} has no messages to migrate.`);
      continue;
    }

    const sessionId = randomUUID();
    let turnIndex = 0;
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      await db.insert(captureMessages).values({
        courseCode: row.courseCode,
        sessionId,
        turnIndex,
        role: m.role,
        content: m.content,
      });
      turnIndex++;
    }
    console.log(`[migrated] ${row.courseCode} → session ${sessionId} (${turnIndex} turns)`);

    // Link the oldest unlinked snapshot if it doesn't already have a transcript link.
    const latestSnapshot = await db
      .select({ id: courseCaptureSnapshots.id })
      .from(courseCaptureSnapshots)
      .where(and(
        eq(courseCaptureSnapshots.courseCode, row.courseCode),
        isNull(courseCaptureSnapshots.transcriptSessionId),
      ))
      .orderBy(courseCaptureSnapshots.createdAt)
      .limit(1);
    if (latestSnapshot[0]) {
      await db.update(courseCaptureSnapshots)
        .set({ transcriptSessionId: sessionId })
        .where(eq(courseCaptureSnapshots.id, latestSnapshot[0].id));
      console.log(`  → linked snapshot ${latestSnapshot[0].id} to session.`);
    }
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
