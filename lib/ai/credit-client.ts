/** Client-safe: text to show for a failed AI route response (friendly message for the credits case). */
export function apiErrorText(json: unknown, fallback: string): string {
  const j = (json ?? {}) as { error?: unknown; message?: unknown };
  if (j.error === 'ai_credits_exhausted' && typeof j.message === 'string' && j.message) return j.message;
  return typeof j.error === 'string' ? j.error : fallback;
}
