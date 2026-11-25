/**
 * The staged interview's evidence-map session id, remembered per course in this browser so a reload before
 * the first question reuses the map instead of paying for a second pre-read. Every access is guarded:
 * storage can be blocked or throw (private windows), and the page must work without it.
 */
const key = (courseCode: string) => `gc-staged-session:${courseCode}`;

export function readStoredSession(courseCode: string): string | null {
  try { return localStorage.getItem(key(courseCode)) || null; } catch { return null; }
}
export function writeStoredSession(courseCode: string, sessionId: string): void {
  try { localStorage.setItem(key(courseCode), sessionId); } catch { /* storage unavailable */ }
}
export function clearStoredSession(courseCode: string): void {
  try { localStorage.removeItem(key(courseCode)); } catch { /* storage unavailable */ }
}
