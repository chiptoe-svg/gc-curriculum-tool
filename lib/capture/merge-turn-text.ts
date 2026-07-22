/**
 * Merge an audit turn's structured `finding` + `question` into the single block
 * of text the chat UI renders.
 *
 * The prompt now keeps the follow-up question in the `question` field only, so
 * the normal path is `finding` + blank line + `question`. This helper is the
 * defense-in-depth: if the model still slips the question into the `finding`
 * (verbatim OR reworded — it ends the finding with a question), we DON'T append
 * the `question` field again, so faculty never see the question twice.
 */
export function mergeTurnText(finding: string, question: string): string {
  const f = (finding ?? '').trim();
  const q = (question ?? '').trim();
  if (!q) return f;
  if (!f) return q;
  // Exact copy already in the finding → don't repeat it.
  if (f.includes(q)) return f;
  // The finding already ends with a question (a reworded copy the substring
  // check can't catch) → treat the finding as self-contained; don't append.
  const lastLine = f.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (lastLine.endsWith('?')) return f;
  return f + '\n\n' + q;
}
