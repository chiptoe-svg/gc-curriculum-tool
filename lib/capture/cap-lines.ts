/**
 * Shared size-cap algorithm for interview-only at-rest blocks (course-context
 * brief, prerequisite-profiles block): emit lines in order while the total
 * plus a worst-case reserve (a note naming every course that *could* be
 * dropped) stays within maxChars, then append a note naming what was left
 * out. Extracted so both blocks trim identically instead of duplicating the
 * loop. See lib/capture/course-context-brief.ts and
 * lib/capture/prereq-profiles-block.ts.
 */

export interface CapLine { text: string; code?: string }

function note(n: number, droppedCodes: string[]): string {
  return droppedCodes.length > 0
    ? `_(${n} more line(s) left out to stay within the size cap; courses not shown: ${droppedCodes.join(', ')}.)_`
    : `_(${n} more line(s) left out to stay within the size cap.)_`;
}

/**
 * Each entry in `lines` carries `code` only when it is the course's OWN line
 * (the line whose omission means the course itself was dropped, not just one
 * of its sub-items) — that's what the dropped-courses note names.
 */
export function capLines(head: string, lines: CapLine[], maxChars: number): string {
  const allCodes: string[] = [];
  for (const l of lines) {
    if (l.code && !allCodes.includes(l.code)) allCodes.push(l.code);
  }
  // Size the reserve for the worst case — a note naming every course that
  // carries a `code` — so the loop never overshoots maxChars regardless of
  // where the cut actually lands.
  const reserve = note(lines.length, allCodes).length + 1;
  let out = head;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const next = `${out}\n${line.text}`;
    const remainingAfter = lines.length - i - 1;
    if (next.length + (remainingAfter > 0 ? reserve : 0) > maxChars) break;
    out = next;
  }
  if (i < lines.length) {
    const droppedCodes: string[] = [];
    for (let j = i; j < lines.length; j++) {
      const c = lines[j]!.code;
      if (c && !droppedCodes.includes(c)) droppedCodes.push(c);
    }
    out = `${out}\n${note(lines.length - i, droppedCodes)}`;
  }
  return out;
}
