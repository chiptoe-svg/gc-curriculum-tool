import type { CanvasModule } from './fetchCanvasCourse';

// Canvas file URLs embedded in materials follow this shape regardless of which
// course they belong to: /files/{ID}/{download|preview|edit|...}?...
export const CANVAS_FILE_ID_RE = /\/files\/(\d+)(?:\/|\?|"|$)/g;

// Was 20 when the import also extracted every file inside one request on
// Vercel (2026-05-24). The import now only downloads and stores files, and
// runs locally, so the limit only guards against a runaway course.
export const MAX_FILES_PER_IMPORT = 300;

export interface CanvasFilePlan {
  /** File ids to fetch, in order. */
  ids: string[];
  /** Files left out by the limit, named so the instructor can see them. */
  overLimit: Array<{ id: string; name: string }>;
}

/**
 * Which Canvas files an import downloads: every file placed directly in a
 * module (PKSC 2200's syllabus sat in its "Course Information" module and was
 * never fetched), then every /files/{id} link in the imported text.
 */
export function planCanvasFiles(
  scanText: string,
  modules: CanvasModule[],
  max: number = MAX_FILES_PER_IMPORT,
): CanvasFilePlan {
  const titles = new Map<string, string>();
  for (const m of modules) {
    for (const i of m.items) {
      if (i.fileId && !titles.has(i.fileId)) titles.set(i.fileId, i.title);
    }
  }
  const all = new Set<string>(titles.keys());
  for (const m of scanText.matchAll(CANVAS_FILE_ID_RE)) {
    if (m[1]) all.add(m[1]);
  }
  const ordered = Array.from(all);
  return {
    ids: ordered.slice(0, max),
    overLimit: ordered.slice(max).map(id => ({ id, name: titles.get(id) ?? `Canvas file ${id}` })),
  };
}
