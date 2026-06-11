/**
 * wiki-update AI function — orchestrator.
 *
 * Fires on snapshot creation (Task A4 wires the trigger). Loads the snapshot
 * and related Postgres substrate, assembles deterministic raw-layer files,
 * computes which wiki-layer pages need regeneration, calls the LLM, and
 * returns the full page map. The caller (Task A3 / A4) writes + git-commits.
 *
 * The orchestrator only READS from the wiki repo and Postgres. It never writes.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  courseCaptureSnapshots,
  captureMessages,
  snapshotTargetCoverage,
  careerTargets,
  subCompetencies,
  courses,
} from '@/lib/db/schema';
import {
  getSnapshotById,
  type SnapshotRow,
} from '@/lib/db/capture-snapshots-queries';
import type { CaptureProfile, ProductiveFailureConditions } from '@/lib/ai/capture/schema';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { fetchLiveCourseFromSheet } from '@/lib/sheets/fetchLiveCourse';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { writeAndPush } from '@/lib/wiki/git-ops';
import { deriveEvidenceBand, type EvidenceBand } from '@/lib/program/evidence-ladder';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIKI_REPO_PATH =
  process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A file to write to the wiki repo. content is the full file string. */
export interface WikiPageWrite {
  path: string;
  content: string;
}

/** One entry in the wiki-layer page list (before LLM regeneration). */
export interface AffectedWikiPage {
  type: 'course' | 'competency' | 'target' | 'concept' | 'index';
  slug: string;
  path: string;
  existingContent: string | null;
  /** Postgres substrate specific to this page type; absent for course + index. */
  substrate?: unknown;
}

export interface AffectedPages {
  raw: WikiPageWrite[];
  wiki: AffectedWikiPage[];
}

/** What updateWikiForSnapshot returns. */
export interface WikiUpdateResult {
  /** Deterministic raw-layer files (snapshot JSON + optional transcript md). */
  raw: WikiPageWrite[];
  /** LLM-regenerated wiki-layer pages. */
  wiki: WikiPageWrite[];
  /** One-line summary for log.md. */
  logEntry: string;
}

// ---------------------------------------------------------------------------
// Course-slug helpers
// ---------------------------------------------------------------------------

/**
 * Convert a course code like "GC 4800" to a wiki slug like "gc-4800".
 * Matches the slug convention in gc-curriculum-wiki/CLAUDE.md.
 */
export function courseCodeToSlug(courseCode: string): string {
  return courseCode.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Format a Date as "YYYY-MM-DD".
 */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Short id — first 7 hex chars of a UUID (no hyphens).
 */
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 7);
}

// ---------------------------------------------------------------------------
// Step 1 — computeAffectedPages
// ---------------------------------------------------------------------------

/**
 * Compute the full set of affected pages for a snapshot — both deterministic
 * raw-layer writes and the wiki-layer pages the LLM must regenerate.
 *
 * Raw layer is fully deterministic (no LLM call). Wiki layer is the list of
 * pages that need regeneration; the caller will load existing markdown + substrate
 * and then call the LLM.
 */
export async function computeAffectedPages(
  snapshot: SnapshotRow,
  transcriptMarkdown: string | null,
): Promise<AffectedPages> {
  const courseSlug = courseCodeToSlug(snapshot.courseCode);
  const dateStr = toDateStr(snapshot.createdAt);
  const sid = shortId(snapshot.id);

  // --- Raw layer (deterministic) ---
  const snapshotJsonPath = `raw/snapshots/${courseSlug}/${dateStr}_${sid}.json`;
  const raw: WikiPageWrite[] = [
    {
      path: snapshotJsonPath,
      content: JSON.stringify(snapshot.profile, null, 2),
    },
  ];

  if (transcriptMarkdown !== null) {
    const transcriptPath = `raw/transcripts/${courseSlug}/${dateStr}_${sid}.md`;
    raw.push({ path: transcriptPath, content: transcriptMarkdown });
  }

  // --- Wiki layer — compute affected page list ---

  // Always regenerate the course page and the index.
  const wikiPages: AffectedWikiPage[] = [
    { type: 'course', slug: courseSlug, path: `courses/${courseSlug}.md`, existingContent: null },
    { type: 'index', slug: 'index', path: 'index.md', existingContent: null },
  ];

  // Competency + target pages: derive from snapshot_target_coverage for this snapshot.
  const coverageCells = await db
    .select({
      subCompetencyId: snapshotTargetCoverage.subCompetencyId,
      careerTargetId: snapshotTargetCoverage.careerTargetId,
    })
    .from(snapshotTargetCoverage)
    .where(eq(snapshotTargetCoverage.snapshotId, snapshot.id));

  const uniqueSubCompetencyIds = [...new Set(coverageCells.map(c => c.subCompetencyId))];
  const uniqueTargetIds = [...new Set(coverageCells.map(c => c.careerTargetId))];

  for (const subId of uniqueSubCompetencyIds) {
    wikiPages.push({
      type: 'competency',
      slug: subId,
      path: `competencies/${subId}.md`,
      existingContent: null,
    });
  }

  for (const targetId of uniqueTargetIds) {
    wikiPages.push({
      type: 'target',
      slug: targetId,
      path: `targets/${targetId}.md`,
      existingContent: null,
    });
  }

  // Concept pages (conditional).
  // productive-failure: if audit_notes.productive_failure_conditions is populated.
  const pfc = snapshot.profile.audit_notes?.productive_failure_conditions;
  if (pfc != null) {
    wikiPages.push({
      type: 'concept',
      slug: 'productive-failure',
      path: 'concepts/productive-failure.md',
      existingContent: null,
    });
  }

  // three-act-structure: always include when the snapshot has a course level
  // (act-placement signal always present for level-carrying courses).
  wikiPages.push({
    type: 'concept',
    slug: 'three-act-structure',
    path: 'concepts/three-act-structure.md',
    existingContent: null,
  });

  return { raw, wiki: wikiPages };
}

// ---------------------------------------------------------------------------
// Transcript rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render a capture_messages session as markdown. One ## heading per turn
 * (role + turn_index + timestamp). Tool calls in a ```json block. Citations
 * inline. Only called for v2 snapshots where transcriptSessionId is set.
 */
async function renderTranscriptMarkdown(
  courseCode: string,
  sessionId: string,
): Promise<string> {
  const rows = await db
    .select()
    .from(captureMessages)
    .where(
      and(
        eq(captureMessages.courseCode, courseCode),
        eq(captureMessages.sessionId, sessionId),
      ),
    )
    .orderBy(captureMessages.turnIndex);

  const lines: string[] = [
    `# Audit Transcript — ${courseCode}`,
    '',
    `Session: \`${sessionId}\``,
    '',
  ];

  for (const row of rows) {
    const ts = row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt);
    lines.push(`## Turn ${row.turnIndex} — ${row.role} — ${ts}`);
    lines.push('');

    if (row.content) {
      lines.push(row.content);
      lines.push('');
    }

    if (row.toolCalls && row.toolCalls.length > 0) {
      lines.push('**Tool calls:**');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(row.toolCalls, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (row.toolResult && row.toolResult.length > 0) {
      lines.push('**Tool results:**');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(row.toolResult, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (row.citations && row.citations.length > 0) {
      const citationStr = row.citations
        .map(c =>
          c.type === 'chunk'
            ? `[c#${c.chunkId ?? 'unknown'}]`
            : `[m#${c.messageId ?? 'unknown'}]`,
        )
        .join(' ');
      lines.push(`**Citations:** ${citationStr}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Substrate loaders
// ---------------------------------------------------------------------------

interface ContributingCell {
  courseCode: string;
  courseSlug: string;
  snapshotId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
}

async function loadCompetencySubstrate(subCompetencyId: string): Promise<{
  contributingCells: ContributingCell[];
}> {
  // Get all non-retired snapshots' cells for this sub-competency. Join to get
  // the course code from the snapshot.
  const rows = await db
    .select({
      courseCode: courseCaptureSnapshots.courseCode,
      snapshotId: snapshotTargetCoverage.snapshotId,
      kDepth: snapshotTargetCoverage.kDepth,
      uDepth: snapshotTargetCoverage.uDepth,
      dDepth: snapshotTargetCoverage.dDepth,
      matchedCompetency: snapshotTargetCoverage.matchedCompetency,
      evidenceExcerpt: snapshotTargetCoverage.evidenceExcerpt,
    })
    .from(snapshotTargetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(snapshotTargetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .where(eq(snapshotTargetCoverage.subCompetencyId, subCompetencyId));

  const contributingCells: ContributingCell[] = rows.map(r => ({
    courseCode: r.courseCode,
    courseSlug: courseCodeToSlug(r.courseCode),
    snapshotId: r.snapshotId,
    kDepth: r.kDepth,
    uDepth: r.uDepth,
    dDepth: r.dDepth,
    matchedCompetency: r.matchedCompetency,
    evidenceExcerpt: r.evidenceExcerpt,
  }));

  // Sort highest dDepth first.
  contributingCells.sort((a, b) => b.dDepth - a.dDepth);

  return { contributingCells };
}

interface CoverageRollupEntry {
  subCompetencyId: string;
  subCompetencyName: string;
  bestCourseCode: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  evidenceExcerpt: string | null;
}

async function loadTargetSubstrate(targetId: string): Promise<{
  targetName: string;
  shortDefinition: string;
  industryContexts: string[];
  coverageRollup: CoverageRollupEntry[];
  contributingCourses: string[];
}> {
  const targetRows = await db
    .select()
    .from(careerTargets)
    .where(eq(careerTargets.id, targetId))
    .limit(1);
  const target = targetRows[0];
  if (!target) {
    return {
      targetName: targetId,
      shortDefinition: '',
      industryContexts: [],
      coverageRollup: [],
      contributingCourses: [],
    };
  }

  // All sub-competencies for this target.
  const subs = await db
    .select()
    .from(subCompetencies)
    .where(and(eq(subCompetencies.careerTargetId, targetId), eq(subCompetencies.retired, false)));

  if (subs.length === 0) {
    return {
      targetName: target.name,
      shortDefinition: target.shortDefinition,
      industryContexts: target.industryContexts,
      coverageRollup: [],
      contributingCourses: [],
    };
  }

  const subIds = subs.map(s => s.id);

  // For each sub-competency, find the best (highest dDepth) cell across non-retired snapshots.
  const cellRows = await db
    .select({
      subCompetencyId: snapshotTargetCoverage.subCompetencyId,
      courseCode: courseCaptureSnapshots.courseCode,
      snapshotId: snapshotTargetCoverage.snapshotId,
      kDepth: snapshotTargetCoverage.kDepth,
      uDepth: snapshotTargetCoverage.uDepth,
      dDepth: snapshotTargetCoverage.dDepth,
      evidenceExcerpt: snapshotTargetCoverage.evidenceExcerpt,
    })
    .from(snapshotTargetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(snapshotTargetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .where(
      and(
        eq(snapshotTargetCoverage.careerTargetId, targetId),
        inArray(snapshotTargetCoverage.subCompetencyId, subIds),
      ),
    );

  // Build rollup: best dDepth per sub-competency.
  const bestBySub = new Map<string, typeof cellRows[0]>();
  for (const cell of cellRows) {
    const existing = bestBySub.get(cell.subCompetencyId);
    if (!existing || cell.dDepth > existing.dDepth) {
      bestBySub.set(cell.subCompetencyId, cell);
    }
  }

  const subById = new Map(subs.map(s => [s.id, s]));
  const coverageRollup: CoverageRollupEntry[] = subs.map(s => {
    const best = bestBySub.get(s.id);
    return {
      subCompetencyId: s.id,
      subCompetencyName: s.name,
      bestCourseCode: best?.courseCode ?? '',
      kDepth: best?.kDepth ?? null,
      uDepth: best?.uDepth ?? null,
      dDepth: best?.dDepth ?? 0,
      evidenceExcerpt: best?.evidenceExcerpt ?? null,
    };
  });
  void subById; // used for name lookup above

  const contributingCourseCodes = [...new Set(
    cellRows.filter(c => c.dDepth > 0).map(c => c.courseCode),
  )];
  const contributingCourses = contributingCourseCodes.map(courseCodeToSlug);

  return {
    targetName: target.name,
    shortDefinition: target.shortDefinition,
    industryContexts: target.industryContexts,
    coverageRollup,
    contributingCourses,
  };
}

async function loadConceptSubstrate(
  slug: string,
): Promise<{ coursesWithConditions: Array<{ courseCode: string; courseSlug: string; conditions: ProductiveFailureConditions }> }> {
  if (slug !== 'productive-failure') {
    // three-act-structure and scaffolding-analysis don't need a special substrate query
    // beyond what the snapshot itself provides.
    return { coursesWithConditions: [] };
  }

  // Load all non-retired snapshots that have productive_failure_conditions populated.
  // We use a raw SQL cast to check the JSONB field.
  const rows = await db
    .select({
      courseCode: courseCaptureSnapshots.courseCode,
      profile: courseCaptureSnapshots.profile,
    })
    .from(courseCaptureSnapshots)
    .where(
      and(
        isNull(courseCaptureSnapshots.retiredAt),
        sql`${courseCaptureSnapshots.profile}->'audit_notes'->'productive_failure_conditions' IS NOT NULL`,
      ),
    )
    .orderBy(desc(courseCaptureSnapshots.createdAt));

  // De-duplicate by course code (keep newest).
  const seen = new Set<string>();
  const coursesWithConditions: Array<{ courseCode: string; courseSlug: string; conditions: ProductiveFailureConditions }> = [];
  for (const row of rows) {
    if (seen.has(row.courseCode)) continue;
    seen.add(row.courseCode);
    const pfc = (row.profile as CaptureProfile).audit_notes?.productive_failure_conditions;
    if (pfc) {
      coursesWithConditions.push({
        courseCode: row.courseCode,
        courseSlug: courseCodeToSlug(row.courseCode),
        conditions: pfc,
      });
    }
  }

  return { coursesWithConditions };
}

// ---------------------------------------------------------------------------
// Existing wiki page reader
// ---------------------------------------------------------------------------

async function readExistingWikiPage(relPath: string): Promise<string | null> {
  const abs = path.join(WIKI_REPO_PATH, relPath);
  try {
    return await readFile(abs, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// All snapshots for a course (for "Source snapshots" section)
// ---------------------------------------------------------------------------

interface SnapshotSummary {
  id: string;
  caption: string | null;
  createdAt: Date;
  snapshotJsonPath: string;
}

async function loadAllSnapshotsForCourse(courseCode: string): Promise<SnapshotSummary[]> {
  const rows = await db
    .select({
      id: courseCaptureSnapshots.id,
      caption: courseCaptureSnapshots.caption,
      createdAt: courseCaptureSnapshots.createdAt,
    })
    .from(courseCaptureSnapshots)
    .where(
      and(
        eq(courseCaptureSnapshots.courseCode, courseCode),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .orderBy(desc(courseCaptureSnapshots.createdAt));

  const courseSlug = courseCodeToSlug(courseCode);
  return rows.map(r => ({
    id: r.id,
    caption: r.caption,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    snapshotJsonPath: `raw/snapshots/${courseSlug}/${toDateStr(r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt))}_${shortId(r.id)}.json`,
  }));
}

// ---------------------------------------------------------------------------
// Course-info loader (extended 2026-06-08: sheet merge)
// ---------------------------------------------------------------------------

/** Shape of the DB columns we select from `courses`. */
export interface CourseDbRow {
  title: string | null;
  level: number | null;
  prerequisites: string | string[] | null;
}

interface CourseInfo {
  title: string;
  level: number;
  prerequisites: string[];
  sheetDescription: string | null;
  sheetLearningObjectives: string[];
  sheetMajorProjects: string[];
  sheetSkillsRequired: string[];
  syllabusUrl: string | null;
  sheetSourceUrl: string | null;
}

// Exported for unit tests — no I/O.
export type CourseInfoExtended = CourseInfo;

/**
 * Pure merge function — exported for tests.
 * Merges live sheet data (may be null) onto the DB row.
 * Sheet fields take precedence for live content.
 */
export function mergeCourseInfo(
  row: CourseDbRow,
  sheet: ParsedCourse | null,
): CourseInfo {
  const prereqRaw = row.prerequisites;
  const prerequisites: string[] = Array.isArray(prereqRaw)
    ? (prereqRaw as string[]).map(p => courseCodeToSlug(String(p)))
    : typeof prereqRaw === 'string' && prereqRaw.trim().length > 0
      ? prereqRaw.split(',').map(p => courseCodeToSlug(p.trim())).filter(Boolean)
      : [];

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim() ?? null;

  return {
    title: sheet?.title ?? row.title ?? '',
    level: sheet?.level ?? row.level ?? 0,
    prerequisites,
    sheetDescription: sheet?.description ?? null,
    sheetLearningObjectives: sheet?.learningObjectives ?? [],
    sheetMajorProjects: sheet?.majorProjects ?? [],
    sheetSkillsRequired: sheet?.skillsRequired ?? [],
    syllabusUrl: sheet?.syllabusUrl ?? null,
    sheetSourceUrl: sheet && sheetId
      ? `https://docs.google.com/spreadsheets/d/${sheetId}`
      : null,
  };
}

async function loadCourseInfo(courseCode: string): Promise<CourseInfo> {
  // 1. Try the live sheet first (5s timeout, 60s in-process cache, fails silently).
  const sheetData = await fetchLiveCourseFromSheet(courseCode);

  // 2. Fall back to the DB courses row for fields the sheet didn't return.
  const rows = await db
    .select({
      title: courses.title,
      level: courses.level,
      prerequisites: courses.prerequisites,
    })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);

  const row = rows[0] ?? { title: courseCode, level: 0, prerequisites: null };
  return mergeCourseInfo(row, sheetData);
}

// ---------------------------------------------------------------------------
// JSON schema for wiki-update output (strict-mode compliant)
// ---------------------------------------------------------------------------

const wikiUpdateJsonSchema = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          // content can be very long (600–2000 words of markdown) — no maxLength.
          content: { type: 'string' },
          operation: { type: 'string', enum: ['create', 'update', 'unchanged'] },
        },
        required: ['path', 'content', 'operation'],
        additionalProperties: false,
      },
    },
    log_entry: { type: 'string' },
  },
  required: ['pages', 'log_entry'],
  additionalProperties: false,
} as const;

type WikiUpdateOutput = {
  pages: Array<{ path: string; content: string; operation: 'create' | 'update' | 'unchanged' }>;
  log_entry: string;
};

function validateWikiUpdateOutput(raw: unknown): WikiUpdateOutput {
  if (typeof raw !== 'object' || raw === null) throw new Error('wiki-update: output is not an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.pages)) throw new Error('wiki-update: pages is not an array');
  if (typeof r.log_entry !== 'string') throw new Error('wiki-update: log_entry is not a string');

  const pages: WikiUpdateOutput['pages'] = [];
  for (const p of r.pages) {
    if (typeof p !== 'object' || p === null) throw new Error('wiki-update: page entry is not an object');
    const pe = p as Record<string, unknown>;
    if (typeof pe.path !== 'string') throw new Error('wiki-update: page.path is not a string');
    if (typeof pe.content !== 'string') throw new Error('wiki-update: page.content is not a string');
    const op = pe.operation;
    if (op !== 'create' && op !== 'update' && op !== 'unchanged') {
      throw new Error(`wiki-update: page.operation has unexpected value: ${String(op)}`);
    }
    pages.push({ path: pe.path, content: pe.content, operation: op });
  }

  return { pages, log_entry: r.log_entry as string };
}

// ---------------------------------------------------------------------------
// Step 4 — updateWikiForSnapshot (main orchestrator)
// ---------------------------------------------------------------------------

/**
 * Max affected wiki pages emitted per LLM call. A single wiki-update call must
 * return EVERY affected page as one strict-mode JSON response; at full target
 * coverage that set can exceed 30 pages (course + index + one page per
 * sub-competency + one per target), whose combined output overruns the model's
 * practical response size and silently stalls the request (no timeout, no
 * streaming progress — the call just never returns). Splitting the affected
 * pages into bounded batches keeps every call small and reliable.
 */
const WIKI_PAGES_PER_CALL = 6;

function chunkPages<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Reconcile + watermark (increment C — loud-not-silent omission + staleness)
// ---------------------------------------------------------------------------

/**
 * Pure: which REQUESTED page paths did the model NOT return in its output?
 * A batch where the model silently omits a requested page is myKG's "loses
 * things" failure mode; the caller re-requests these once and then logs a hard
 * reconcile warning rather than letting them vanish. 'unchanged' counts as
 * produced — the model explicitly accounted for the page.
 */
export function missingPagePaths(
  requested: ReadonlyArray<{ path: string }>,
  produced: ReadonlyArray<{ path: string }>,
): string[] {
  const got = new Set(produced.map(p => p.path));
  return requested.filter(p => !got.has(p.path)).map(p => p.path);
}

/**
 * Pure: a deterministic short watermark over the inputs that produced a page —
 * the immutable snapshot id plus a hash of the page's input substrate. Stored
 * in page frontmatter (`input_hash`) so a reconcile pass can detect a page
 * whose inputs have since changed (stale) or that was never written (missing)
 * without re-running the LLM. Stable across runs given the same inputs because
 * the substrate is built from deterministically-ordered queries.
 */
export function computeInputHash(
  snapshotId: string,
  page: { type: AffectedWikiPage['type']; slug: string; substrate?: unknown },
): string {
  const payload = JSON.stringify({
    snapshotId,
    type: page.type,
    slug: page.slug,
    substrate: page.substrate ?? null,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** One competency's derived evidence band, keyed by statement for the prompt. */
export interface CompetencyBand {
  statement: string;
  band: EvidenceBand;
}

/**
 * Pure: derive each competency's evidence band (claimed / materials_supported /
 * artifact_verified) from the provenance already on the profile (source +
 * citations). Passed into the wiki-update prompt so the course page can render
 * a band marker per competency line instead of flattening every claim to
 * settled fact. Keyed by `statement` — the prompt matches competencies by
 * statement when rendering the "Competencies developed" list.
 */
export function deriveCompetencyBands(
  competencies: ReadonlyArray<{ statement: string; source?: unknown; citations?: unknown }>,
): CompetencyBand[] {
  return competencies.map(c => ({
    statement: c.statement,
    band: deriveEvidenceBand({
      source: c.source as Parameters<typeof deriveEvidenceBand>[0]['source'],
      citations: c.citations as Parameters<typeof deriveEvidenceBand>[0]['citations'],
    }),
  }));
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Pure: stamp `input_hash: <hash>` into a page's YAML frontmatter, replacing an
 * existing value or appending into the block. If the page has no frontmatter,
 * one is prepended carrying just the watermark.
 */
export function stampInputHash(content: string, inputHash: string): string {
  const line = `input_hash: ${inputHash}`;
  const m = content.match(FRONTMATTER_RE);
  if (m) {
    const body = /^input_hash:\s*.*$/m.test(m[1]!)
      ? m[1]!.replace(/^input_hash:\s*.*$/m, line)
      : `${m[1]!}\n${line}`;
    return content.replace(FRONTMATTER_RE, `---\n${body}\n---\n`);
  }
  return `---\n${line}\n---\n\n${content}`;
}

/**
 * Main entry point. Loads the snapshot, builds raw-layer writes, assembles
 * wiki-page substrate, calls the LLM (in bounded batches so a full-coverage
 * page set can't overrun the response size), validates the output, and returns
 * the full page map + log entry.
 *
 * The caller (Task A3/A4) is responsible for writing files and committing.
 */
export async function updateWikiForSnapshot(snapshotId: string): Promise<WikiUpdateResult> {
  // (a) Load the snapshot.
  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) throw new Error(`wiki-update: snapshot ${snapshotId} not found`);

  const courseSlug = courseCodeToSlug(snapshot.courseCode);

  // (b) Build deterministic raw-layer writes.
  //    Transcript: only for v2 captures (transcriptSessionId set).
  let transcriptMarkdown: string | null = null;
  if (snapshot.transcriptSessionId) {
    transcriptMarkdown = await renderTranscriptMarkdown(
      snapshot.courseCode,
      snapshot.transcriptSessionId,
    );
  }

  const { raw, wiki: affectedWikiPages } = await computeAffectedPages(snapshot, transcriptMarkdown);

  // (c) For each affected wiki page: load existing markdown + substrate.
  const courseInfo = await loadCourseInfo(snapshot.courseCode);
  const allSnapshots = await loadAllSnapshotsForCourse(snapshot.courseCode);

  const rawPaths = {
    snapshotJson: raw.find(p => p.path.startsWith('raw/snapshots/'))?.path ?? null,
    transcriptMd: raw.find(p => p.path.startsWith('raw/transcripts/'))?.path ?? null,
  };

  const pagesWithSubstrate: Array<AffectedWikiPage & { substrate?: unknown }> = await Promise.all(
    affectedWikiPages.map(async page => {
      const existingContent = await readExistingWikiPage(page.path);
      let substrate: unknown = undefined;

      switch (page.type) {
        case 'competency':
          substrate = await loadCompetencySubstrate(page.slug);
          break;
        case 'target':
          substrate = await loadTargetSubstrate(page.slug);
          break;
        case 'concept':
          substrate = await loadConceptSubstrate(page.slug);
          break;
        case 'course':
        case 'index':
          // No external substrate needed — everything comes from the snapshot.
          break;
      }

      return { ...page, existingContent, substrate };
    }),
  );

  // (d) Load the prompt + provider once.
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('wiki-update'),
    loadPrompt('wiki-update'),
  ]);

  // (e) Generate pages in bounded batches (see WIKI_PAGES_PER_CALL). Each batch
  //     is its own LLM call over the SAME snapshot context but only its slice of
  //     affected pages, so no single response can overrun and stall. When the
  //     affected set fits in one batch this is identical to the old one-shot
  //     path. computeAffectedPages orders course + index first, so they ride in
  //     the first batch together.
  const batches = chunkPages(pagesWithSubstrate, WIKI_PAGES_PER_CALL);
  const generatedPages: WikiUpdateOutput['pages'] = [];
  const logEntries: string[] = [];

  // Evidence band per competency (increment A): derived deterministically from
  // the profile's source + citations so the course page renders a credibility
  // marker per competency line rather than flattening every claim to fact.
  const competencyBands = deriveCompetencyBands(snapshot.profile.competencies);

  // One LLM call over the SAME snapshot context but only the given slice of
  // affected pages. Used for the primary batch pass and the reconcile retry.
  const generateBatch = async (
    batch: Array<AffectedWikiPage & { substrate?: unknown }>,
  ): Promise<WikiUpdateOutput> => {
    const userMessage = JSON.stringify({
      snapshot: {
        id: snapshot.id,
        courseCode: snapshot.courseCode,
        courseSlug,
        courseTitle: courseInfo.title,
        courseLevel: courseInfo.level,
        coursePrerequisites: courseInfo.prerequisites,
        caption: snapshot.caption,
        reviewerNote: snapshot.reviewerNote,
        createdAt: snapshot.createdAt.toISOString(),
        profile: snapshot.profile,
        // New fields (2026-06-08): live sheet data — null/empty when sheet unavailable.
        courseDescription: courseInfo.sheetDescription,
        courseLearningObjectives: courseInfo.sheetLearningObjectives,
        courseMajorProjects: courseInfo.sheetMajorProjects,
        courseSkillsRequired: courseInfo.sheetSkillsRequired,
        syllabusUrl: courseInfo.syllabusUrl,
        sheetSourceUrl: courseInfo.sheetSourceUrl,
      },
      rawPaths,
      allSnapshotsForCourse: allSnapshots,
      competencyBands,
      affectedWikiPages: batch,
    });

    const { data } = await provider.complete<WikiUpdateOutput>({
      systemPrompt,
      userMessage,
      schemaName: 'wiki_update',
      jsonSchema: wikiUpdateJsonSchema,
      validate: validateWikiUpdateOutput,
    });
    return data;
  };

  for (const batch of batches) {
    const data = await generateBatch(batch);
    generatedPages.push(...data.pages);
    if (data.log_entry) logEntries.push(data.log_entry);

    // Reconcile: a batch where the model silently dropped a requested page is
    // the known `batch-page-dropped` debt (myKG's "loses things"). Diff
    // requested vs produced, re-request the missing pages ONCE, and if any are
    // still absent, log a hard reconcile failure rather than let them vanish.
    const missing = missingPagePaths(batch, data.pages);
    if (missing.length > 0) {
      const tag = `course ${snapshot.courseCode}, snapshot ${snapshot.id.slice(0, 8)}`;
      console.error(
        `[wiki-update] batch omitted ${missing.length} requested page(s); re-requesting once (${tag}): ${missing.join(', ')}`,
      );
      const retryBatch = batch.filter(p => missing.includes(p.path));
      const retry = await generateBatch(retryBatch);
      generatedPages.push(...retry.pages);
      if (retry.log_entry) logEntries.push(retry.log_entry);

      const stillMissing = missingPagePaths(retryBatch, retry.pages);
      if (stillMissing.length > 0) {
        console.error(
          `[wiki-update] RECONCILE FAILURE: ${stillMissing.length} page(s) still missing after retry (${tag}): ${stillMissing.join(', ')}`,
        );
      }
    }
  }

  // (f) Build the final wiki write list (filter out 'unchanged' pages).
  //     SECURITY (F8): the model returns page paths as free-form strings. The
  //     traversal guard in git-ops only stops paths escaping the repo — it still
  //     permits ANY in-repo path (log.md, .git-adjacent files, pages outside
  //     this run's scope). So trust a returned path only if it is in the
  //     caller-owned, deterministic requested set (affectedWikiPages, built by
  //     computeAffectedPages). Anything else is a steered/hallucinating model
  //     and is dropped with a hard log rather than written. The raw/ layer is
  //     written by the caller, not the model, so it isn't in this set by design.
  const requestedPaths = new Set(pagesWithSubstrate.map(p => p.path));
  // Per-page input watermark: hash of the (immutable snapshot id + page
  // substrate) that produced each requested page. Stamped into frontmatter so a
  // later reconcile pass can detect stale/missing pages deterministically.
  const inputHashByPath = new Map(
    pagesWithSubstrate.map(p => [p.path, computeInputHash(snapshot.id, p)]),
  );
  // Dedup by path keeping the LAST occurrence — a reconcile retry can re-emit a
  // page the first pass also returned; the retry is the authoritative copy.
  const latestByPath = new Map<string, WikiUpdateOutput['pages'][number]>();
  for (const p of generatedPages) latestByPath.set(p.path, p);

  const wiki: WikiPageWrite[] = [];
  for (const p of latestByPath.values()) {
    if (p.operation === 'unchanged') continue;
    if (!requestedPaths.has(p.path)) {
      console.error(
        `[wiki-update] dropping unrequested page path from model output: "${p.path}" ` +
        `(course ${snapshot.courseCode}, snapshot ${snapshot.id.slice(0, 8)})`,
      );
      continue;
    }
    const content = stampInputHash(p.content, inputHashByPath.get(p.path) ?? '');
    wiki.push({ path: p.path, content });
  }

  return {
    raw,
    wiki,
    logEntry: logEntries.join(' · ') || `wiki-update: ${snapshot.courseCode} (${snapshot.id.slice(0, 8)})`,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — fire-and-forget background regeneration (snapshot create + post-scoring)
// ---------------------------------------------------------------------------

/**
 * Regenerate + push the wiki for a snapshot, fire-and-forget. Two call sites:
 *   1. snapshot creation (course + concept pages + index), and
 *   2. AFTER coverage scoring (`program-score-coverage` writes
 *      `snapshot_target_coverage`) — this is what lets the COMPETENCY and
 *      TARGET pages generate at all, since `computeAffectedPages` derives them
 *      from coverage rows that don't exist yet at snapshot-creation time.
 *
 * Non-blocking and never throws to the caller: a wiki-gen failure must not
 * break capture or coverage scoring. Errors are logged.
 */
export function regenerateWikiInBackground(snapshotId: string, reason: string): void {
  void (async () => {
    try {
      const snap = await getSnapshotById(snapshotId);
      const { raw, wiki, logEntry } = await updateWikiForSnapshot(snapshotId);
      const allPages = [...raw, ...wiki];
      const codeSlug = (snap?.courseCode ?? 'wiki').toLowerCase().replace(/\s+/g, '-');
      const date = new Date().toISOString().slice(0, 10);
      const commitMessage = `feat(${codeSlug}): ${reason} ${date}${snap?.caption ? ` — ${snap.caption}` : ''}`;
      await writeAndPush({ pages: allPages, logEntry, commitMessage });
    } catch (err) {
      console.error(
        '[wiki regen] failed for snapshot', snapshotId, 'reason:', reason,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}
