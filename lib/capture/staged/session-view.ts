import { getInterviewSession } from '@/lib/db/capture-interview-sessions-queries';
import { getSessionMessages } from '@/lib/db/capture-messages-queries';
import type { AuditStagedBlock } from '@/lib/ai/agent/audit-response-schema';
import { stagedFromStoredReply } from './ui-mode';

export type StagedSessionView = {
  /** True when the session has a capture_interview_sessions row for this course. */
  isStaged: boolean;
  /** The latest interviewer reply's staged block (restores the stage bar after a reload); null before the first turn. */
  staged: AuditStagedBlock | null;
  mapStatus: 'pending' | 'ready' | 'failed' | 'none' | null;
};

const CLASSIC: StagedSessionView = { isStaged: false, staged: null, mapStatus: null };

/** What the page needs to resume a session: whether it is staged, where it stands, and how its map read went. */
export async function loadStagedSessionView(courseCode: string, sessionId: string | null): Promise<StagedSessionView> {
  if (!sessionId) return CLASSIC;
  const row = await getInterviewSession(sessionId);
  if (!row || row.courseCode !== courseCode) return CLASSIC;
  const turns = await getSessionMessages(courseCode, sessionId);
  const lastReply = [...turns].reverse().find(m => m.role === 'assistant');
  return { isStaged: true, staged: stagedFromStoredReply(lastReply?.content ?? null), mapStatus: row.mapStatus };
}
