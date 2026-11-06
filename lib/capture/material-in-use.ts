/**
 * Whether a course material may reach the AI: the interviewer's context and
 * search, the scorer, and the other per-course AI calls. A material is out
 * when faculty (or the privacy check, or a newer syllabus) set it aside from
 * the AI (`ignored`), or when it was retired because the course no longer
 * does it (`retiredAt`) — owner 2026-11-06.
 */
export function isSentToAI(m: { ignored: boolean; retiredAt: Date | null }): boolean {
  return !m.ignored && m.retiredAt == null;
}
