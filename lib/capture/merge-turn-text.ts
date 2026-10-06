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

/** An interviewer turn split for display: the finding text and the follow-up question. */
export interface TurnParts {
  body: string;
  question: string | null;
}

const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/**
 * Split text into body + trailing question: the final paragraph (blank-line
 * separated) counts as the question only when it ends with "?". Used for turns
 * rehydrated from history, where only the merged text survives.
 */
export function extractTrailingQuestion(text: string): TurnParts {
  const t = (text ?? '').trim();
  if (!t) return { body: '', question: null };
  const paras = t.split(PARAGRAPH_BREAK).map((p) => p.trim()).filter(Boolean);
  const last = paras[paras.length - 1] ?? '';
  if (!last.endsWith('?')) return { body: paras.join('\n\n'), question: null };
  return { body: paras.slice(0, -1).join('\n\n'), question: last };
}

/**
 * Split a new turn's structured `finding` + `question` for display, so the
 * question can be rendered on its own. Same never-twice rule as mergeTurnText:
 * an exact copy inside the finding is removed; a finding that already ends with
 * a (reworded) question keeps that paragraph as the question and drops the field.
 */
export function splitTurnText(finding: string, question: string): TurnParts {
  const f = (finding ?? '').trim();
  const q = (question ?? '').trim();
  if (!q) return extractTrailingQuestion(f);
  if (!f) return { body: '', question: q };
  if (f.includes(q)) {
    const body = f.split(q).map((s) => s.trim()).filter(Boolean).join('\n\n');
    return { body, question: q };
  }
  const trailing = extractTrailingQuestion(f);
  if (trailing.question) return trailing;
  return { body: f, question: q };
}

/** Display parts for a stored assistant message (new turns carry `question`). */
export function turnParts(message: { content: string; question?: string }): TurnParts {
  const content = (message.content ?? '').trim();
  const q = (message.question ?? '').trim();
  if (q && content.endsWith(q)) {
    return { body: content.slice(0, content.length - q.length).trim(), question: q };
  }
  return extractTrailingQuestion(content);
}

/** Inverse of splitTurnText: the single text stored as the message `content`. */
export function joinTurnParts(parts: TurnParts): string {
  return [parts.body, parts.question].filter((s): s is string => !!s).join('\n\n');
}
