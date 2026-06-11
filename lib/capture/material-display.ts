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
 * The Step 1 materials gate shows only on a genuinely fresh audit: the chat
 * stage, no messages yet, and the landing sub-step still on 'materials'.
 * Resuming (messages exist) or any non-chat stage skips it.
 */
export function shouldShowMaterialsStep(args: {
  stage: string;
  messagesCount: number;
  landingStep: 'materials' | 'interview';
}): boolean {
  return args.stage === 'chat' && args.messagesCount === 0 && args.landingStep === 'materials';
}
