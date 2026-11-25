import { AuditResponseSchema, type AuditStagedBlock } from '@/lib/ai/agent/audit-response-schema';

/**
 * Staged or classic for a NEW interview (plan 2026-11-25, Task 8): staged when the page is opened with
 * ?interview=staged, or when INTERVIEW_STAGED_DEFAULT=on and the link does not say ?interview=classic.
 * A session already in progress follows its own capture_interview_sessions row instead, never this.
 */
export function chooseStaged(interviewParam: string | undefined, envDefault: string | undefined): boolean {
  if (interviewParam === 'staged') return true;
  return envDefault === 'on' && interviewParam !== 'classic';
}

/** The staged block in one stored interviewer reply (capture_messages content = the AuditResponse JSON), or null. */
export function stagedFromStoredReply(content: string | null): AuditStagedBlock | null {
  if (!content) return null;
  try {
    const staged = (JSON.parse(content) as { staged?: unknown }).staged;
    const parsed = AuditResponseSchema.shape.staged.safeParse(staged);
    return parsed.success ? parsed.data ?? null : null;
  } catch {
    return null;
  }
}
