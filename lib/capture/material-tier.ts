/**
 * Tiered ingestion classifier.
 *
 * Assigns each discovered material a tier:
 *   high        → full pipeline (syllabus, graded/assessed content)
 *   middle      → per-unit summary (instructional content, slide decks)
 *   background  → one digest (readings, references)
 *
 * Part A: structure-first, deterministic by manifest kind.
 * Part B: file-bucket classifier — PPTX/Keynote → middle deterministically;
 *         other files call the 'material-classify' LLM, defaulting to
 *         'background' on any error (bias cheap).
 */

import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = 'high' | 'middle' | 'background';

export type ManifestKind =
  | 'syllabus'
  | 'assignments'
  | 'pages'
  | 'discussions'
  | 'quizzes'
  | 'modules'
  | 'file';

export interface FileSignals {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  slideCount?: number;
  peekText?: string;
}

// ---------------------------------------------------------------------------
// Part A — structure-first classifier
// ---------------------------------------------------------------------------

const KIND_TIER: Record<Exclude<ManifestKind, 'file'>, Tier> = {
  syllabus: 'high',
  assignments: 'high',
  quizzes: 'high',
  pages: 'middle',
  discussions: 'middle',
  modules: 'middle',
};

/**
 * Returns the tier for a non-file manifest kind, or null for 'file'
 * (which requires signal-based classification via classifyFile).
 */
export function classifyByKind(kind: ManifestKind): Tier | null {
  return kind === 'file' ? null : KIND_TIER[kind];
}

// ---------------------------------------------------------------------------
// Part B — file-bucket classifier
// ---------------------------------------------------------------------------

/** MIME types that indicate a slide deck — no LLM call needed. */
const SLIDE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.apple.keynote', // .key
]);

/** File extensions that indicate a slide deck regardless of MIME. */
const SLIDE_EXTENSIONS = new Set(['.pptx', '.ppt', '.key']);

function isSlideFile(sig: FileSignals): boolean {
  if (SLIDE_MIME_TYPES.has(sig.mimeType)) return true;
  if (sig.slideCount !== undefined) return true;
  const ext = sig.fileName.slice(sig.fileName.lastIndexOf('.')).toLowerCase();
  return SLIDE_EXTENSIONS.has(ext);
}

const CLASSIFY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tier: { type: 'string', enum: ['middle', 'background'] },
  },
  required: ['tier'],
  additionalProperties: false,
};

function validateClassifyResult(raw: unknown): { tier: 'middle' | 'background' } {
  const r = raw as { tier?: unknown };
  return { tier: r.tier === 'middle' ? 'middle' : 'background' };
}

/**
 * Classifies a file-bucket material into a tier.
 *
 * - Slide decks (PPTX/PPT/Keynote, or any file with slideCount) → middle, no LLM.
 * - All other files → 'material-classify' LLM call → 'middle' | 'background'.
 * - Any error (LLM unavailable, unexpected output) → 'background' (bias cheap).
 */
export async function classifyFile(sig: FileSignals): Promise<Tier> {
  // Deterministic path: slide files
  if (isSlideFile(sig)) return 'middle';

  // LLM path for everything else
  try {
    const systemPrompt = await loadPrompt('material-classify');

    const userLines: string[] = [
      `filename: ${sig.fileName}`,
      `mime_type: ${sig.mimeType}`,
      `size_bytes: ${sig.sizeBytes}`,
    ];
    if (sig.pageCount !== undefined) userLines.push(`page_count: ${sig.pageCount}`);
    if (sig.slideCount !== undefined) userLines.push(`slide_count: ${sig.slideCount}`);
    if (sig.peekText) {
      userLines.push('', 'peek_text (first ~500 chars):', sig.peekText.slice(0, 500));
    }
    userLines.push('', 'Return JSON: {"tier":"middle"|"background"}');

    const provider = await getProviderForFunction('material-classify');
    const { data } = await provider.complete<{ tier: 'middle' | 'background' }>({
      systemPrompt,
      userMessage: userLines.join('\n'),
      schemaName: 'material_classify',
      jsonSchema: CLASSIFY_JSON_SCHEMA,
      validate: validateClassifyResult,
    });

    return data.tier;
  } catch {
    return 'background';
  }
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

/**
 * Classifies any manifest item into a tier. For non-file kinds this is
 * purely deterministic; for files it may invoke the LLM.
 */
export async function classifyManifestItem(
  item: { kind: ManifestKind } & Partial<FileSignals>,
): Promise<Tier> {
  const structural = classifyByKind(item.kind);
  if (structural !== null) return structural;

  // Must be 'file' — need signals
  return classifyFile({
    fileName: item.fileName ?? '',
    mimeType: item.mimeType ?? 'application/octet-stream',
    sizeBytes: item.sizeBytes ?? 0,
    pageCount: item.pageCount,
    slideCount: item.slideCount,
    peekText: item.peekText,
  });
}
