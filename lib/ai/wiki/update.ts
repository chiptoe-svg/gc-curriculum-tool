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
// Course info loader (for course-page frontmatter fields)
// ---------------------------------------------------------------------------

interface CourseInfo {
  title: string;
  level: number;
  prerequisites: string[];
}

async function loadCourseInfo(courseCode: string): Promise<CourseInfo> {
  const rows = await db
    .select({
      title: courses.title,
      level: courses.level,
      prerequisites: courses.prerequisites,
    })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);

  const row = rows[0];
  if (!row) return { title: courseCode, level: 0, prerequisites: [] };

  // prerequisites may be a string (legacy) or an array depending on schema shape.
  // Use whatever is in the courses table.
  const prereqRaw = row.prerequisites;
  const prerequisites: string[] = Array.isArray(prereqRaw)
    ? (prereqRaw as string[]).map(p => courseCodeToSlug(String(p)))
    : typeof prereqRaw === 'string' && prereqRaw.trim().length > 0
      ? prereqRaw.split(',').map(p => courseCodeToSlug(p.trim())).filter(Boolean)
      : [];

  return {
    title: row.title ?? courseCode,
    level: row.level ?? 0,
    prerequisites,
  };
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
 * Main entry point. Loads the snapshot, builds raw-layer writes, assembles
 * wiki-page substrate, calls the LLM, validates the output, and returns the
 * full page map + log entry.
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

  // (d) Assemble the LLM user message.
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
    },
    rawPaths,
    allSnapshotsForCourse: allSnapshots,
    affectedWikiPages: pagesWithSubstrate,
  });

  // (e) Call the LLM.
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('wiki-update'),
    loadPrompt('wiki-update'),
  ]);

  const { data } = await provider.complete<WikiUpdateOutput>({
    systemPrompt,
    userMessage,
    schemaName: 'wiki_update',
    jsonSchema: wikiUpdateJsonSchema,
    validate: validateWikiUpdateOutput,
  });

  // (f) Build the final wiki write list (filter out 'unchanged' pages).
  const wiki: WikiPageWrite[] = data.pages
    .filter(p => p.operation !== 'unchanged')
    .map(p => ({ path: p.path, content: p.content }));

  return {
    raw,
    wiki,
    logEntry: data.log_entry,
  };
}
