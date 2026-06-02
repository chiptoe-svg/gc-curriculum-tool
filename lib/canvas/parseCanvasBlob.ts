/**
 * Parses a Canvas-list material's concatenated markdown into structured items.
 *
 * Canvas list materials (Canvas: Assignments, Canvas: Discussions, Canvas:
 * Quizzes, Canvas: Pages, Canvas: Module List) are stored as a single
 * extractedText blob where each item is delimited by an `## Title` h2 header.
 * This parser splits on those headers so the UI can render per-item controls
 * and the audit-context builder can filter out items the user has ignored.
 *
 * Item titles include any inline tags appended by the importer
 * (e.g. `## Quiz 4 (10 pts) [classic quiz, unpublished]`). The full
 * header text — without the leading `## ` — is the canonical key used by
 * `course_materials.ignored_items` so the audit filter matches exactly.
 */
export interface CanvasItem {
  /** Full title text as written in the blob (excluding the `## ` prefix). */
  title: string;
  /** The item's body — everything between this header and the next `## ` (or EOF). */
  body: string;
  /** 0-based position in the source blob. Stable across re-imports as long as the import order is. */
  ordinalIndex: number;
}

const H2_RE = /^## (.+)$/gm;

export function parseCanvasBlob(text: string): CanvasItem[] {
  if (!text || !text.trim()) return [];
  // Find every h2 header. Track its title and the offset where its body starts.
  const headers: Array<{ title: string; bodyStart: number; headerStart: number }> = [];
  let m: RegExpExecArray | null;
  H2_RE.lastIndex = 0;
  while ((m = H2_RE.exec(text)) !== null) {
    headers.push({
      title: m[1]!.trim(),
      bodyStart: m.index + m[0]!.length,
      headerStart: m.index,
    });
  }
  if (headers.length === 0) return [];
  return headers.map((h, i) => {
    const bodyEnd = i + 1 < headers.length ? headers[i + 1]!.headerStart : text.length;
    const body = text.slice(h.bodyStart, bodyEnd).trim();
    return { title: h.title, body, ordinalIndex: i };
  });
}

/**
 * Re-emit a Canvas blob excluding items whose title appears in `ignoredTitles`.
 * Used by the audit-context builder so the AI never sees ignored items.
 * Returns the original text unchanged when `ignoredTitles` is empty (fast path).
 */
export function filterCanvasBlob(text: string, ignoredTitles: readonly string[]): string {
  if (ignoredTitles.length === 0) return text;
  const ignored = new Set(ignoredTitles);
  const items = parseCanvasBlob(text);
  if (items.length === 0) return text;
  const kept = items.filter(it => !ignored.has(it.title));
  if (kept.length === items.length) return text;
  // Re-concatenate with the same separator convention the importer used.
  // The importer uses `\n\n` between assignments/modules, `\n\n---\n\n`
  // between pages/discussions/quizzes. We don't have type info here, so
  // use the simpler `\n\n` form — the audit doesn't care about the visual
  // separator, only the content.
  return kept.map(it => `## ${it.title}\n${it.body}`).join('\n\n');
}

/**
 * True for materials whose `fileName` indicates a Canvas-list blob the
 * parser knows how to split. Canvas File: foo.pdf is excluded — those are
 * single-document materials with no internal item structure.
 */
export function isCanvasListMaterial(fileName: string): boolean {
  if (!fileName.startsWith('Canvas:')) return false;
  if (fileName.startsWith('Canvas File:')) return false;
  return true;
}
