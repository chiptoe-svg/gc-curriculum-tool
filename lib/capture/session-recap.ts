/**
 * Which session the "Where we left off" recap should leave out. Only a
 * conversation that is actually being resumed is "in progress"; once a profile
 * is generated the saved conversation is cleared, and that session is history
 * the recap must show (owner, 2026-10-07: GC 1010's morning session vanished).
 */
export function sessionToExcludeFromRecap(
  latestSessionId: string | null,
  savedConversation: { messages: unknown[] } | null,
): string {
  if (!latestSessionId) return '';
  return savedConversation && savedConversation.messages.length > 0 ? latestSessionId : '';
}
