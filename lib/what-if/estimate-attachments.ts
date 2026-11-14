export const CUT_LINE = 'The rest of this file was cut at the 120,000-character limit.';

/** The attachments the estimate reads: only 'ok' files that have text; a cut file says so in one plain line. */
export function estimateAttachments(
  attachments: Array<{ fileName: string; status: string; text: string | null; truncated: boolean }>,
): Array<{ fileName: string; text: string }> {
  return attachments.flatMap(a =>
    a.status === 'ok' && a.text !== null
      ? [{ fileName: a.fileName, text: a.truncated ? `${a.text}\n\n${CUT_LINE}` : a.text }]
      : []);
}
