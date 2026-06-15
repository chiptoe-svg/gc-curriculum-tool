export type MaterialProvenance = 'canvas' | 'uploaded' | 'linked';

const LINKED_PREFIXES = ['Google Doc:', 'Google Slides:', 'Google Sheet:', 'Drive PDF:', 'YouTube:'];

/**
 * Where a material came from, derived from its fileName prefix (the importer
 * stamps these). Canvas list + Canvas File → canvas; Google/Drive/YouTube →
 * linked; anything else is a local upload.
 */
export function materialProvenance(m: { fileName: string }): MaterialProvenance {
  const n = m.fileName;
  if (n.startsWith('Canvas:') || n.startsWith('Canvas File:')) return 'canvas';
  if (LINKED_PREFIXES.some((p) => n.startsWith(p))) return 'linked';
  return 'uploaded';
}

/** The Canvas syllabus list, distinctly named by the importer. */
export function isSyllabusCanvasMaterial(m: { fileName: string }): boolean {
  return m.fileName.startsWith('Canvas: Syllabus');
}

export interface BoxedMaterials<T> { canvas: T[]; other: T[]; }

/**
 * Bucket materials into the Canvas box (anything Canvas-provenance, incl. the
 * labeled syllabus) and the Other box (uploads + linked docs). The Syllabus box
 * is the GC-sheet catalog (course fields) + attached syllabi — not derived here.
 */
export function materialsByBox<T extends { fileName: string }>(materials: T[]): BoxedMaterials<T> {
  const canvas: T[] = []; const other: T[] = [];
  for (const m of materials) {
    (materialProvenance(m) === 'canvas' ? canvas : other).push(m);
  }
  return { canvas, other };
}

export const PROVENANCE_LABEL: Record<MaterialProvenance, string> = {
  canvas: 'Canvas',
  uploaded: 'uploaded',
  linked: 'linked doc',
};

/** Visible label for an indexing status (the dot's tooltip uses similar text). */
export function indexingStatusLabel(status: string): string {
  switch (status) {
    case 'ready': return 'ready';
    case 'indexing': return 'indexing…';
    case 'failed': return 'failed';
    case 'skipped': return 'skipped';
    default: return 'pending';
  }
}

/** Continue is freely available once at least one material exists. */
export function hasMaterials(count: number): boolean {
  return count >= 1;
}

/**
 * The Step 1 materials gate shows in the chat stage whenever the landing
 * sub-step is on 'materials'. This makes the wizard reversible: the interview's
 * "Back to materials" flips landingStep to 'materials' (the conversation in
 * state is preserved), and "Continue to interview" returns to 'interview'. A
 * resumed conversation defaults landingStep to 'interview' so it lands straight
 * in the interview. Non-chat stages skip it.
 */
export function shouldShowMaterialsStep(args: {
  stage: string;
  landingStep: 'materials' | 'interview';
}): boolean {
  return args.stage === 'chat' && args.landingStep === 'materials';
}

export interface CatalogCourseFields {
  description?: string;
  prerequisites?: string;
  learningObjectives?: string[];
  majorProjects?: string[];
  skillsRequired?: string[];
}

/** One-line summary of the catalog fields the auditor reads (non-empty only). */
export function catalogContributionSummary(c: CatalogCourseFields): string {
  const parts: string[] = [];
  if (c.description && c.description.trim()) parts.push('description');
  const lo = c.learningObjectives?.length ?? 0;
  if (lo) parts.push(`${lo} learning objective${lo === 1 ? '' : 's'}`);
  if (c.prerequisites && c.prerequisites.trim()) parts.push('prerequisites');
  const mp = c.majorProjects?.length ?? 0;
  if (mp) parts.push(`${mp} major project${mp === 1 ? '' : 's'}`);
  const sk = c.skillsRequired?.length ?? 0;
  if (sk) parts.push(`${sk} skill${sk === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'no catalog details synced yet';
}

export interface Readability { readable: boolean; label: string; reason?: string; }

/** Whether the auditor can actually read a material, plus a human label + reason. */
export function materialReadability(m: { indexingStatus: string; setAsideReason?: string | null }): Readability {
  switch (m.indexingStatus) {
    case 'ready': return { readable: true, label: 'ready' };
    case 'indexing': return { readable: false, label: 'indexing…' };
    case 'pending': return { readable: false, label: 'not indexed yet' };
    case 'failed': return { readable: false, label: "couldn't be read", reason: 'extraction failed' };
    case 'skipped': return { readable: false, label: 'not readable', reason: m.setAsideReason?.trim() || 'no extractable content (e.g. unshared doc / no captions)' };
    default: return { readable: false, label: 'not indexed yet' };
  }
}

/** Relative time string; `now` is passed in for testability. */
export function relativeTimeFromNow(iso: string | null, now: number): string {
  if (!iso) return 'not synced yet';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'not synced yet';
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** True if any non-ignored material is pending/failed (re-indexing could help). */
export function hasFixablyUnindexed(materials: { indexingStatus: string; ignored?: boolean }[]): boolean {
  return materials.some((m) => !m.ignored && (m.indexingStatus === 'pending' || m.indexingStatus === 'failed'));
}

// ---------------------------------------------------------------------------
// Display helpers shared between OtherMaterialsBox and the manager.
// ---------------------------------------------------------------------------

/** Rough estimate: ~4 chars per token (OpenAI rule of thumb for English). */
export function estimateMaterialTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a token count as "42 tok" or "12.3k tok" or "102k tok". */
export function formatMaterialTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`;
}

/** Human-readable file size. */
export function formatMaterialBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
