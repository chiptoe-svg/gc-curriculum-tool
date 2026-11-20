'use client';

import Link from 'next/link';
import type { CourseStatusRow, CaptureStatus } from '@/lib/db/capture-status-queries';
import type { CourseRosterRow, CourseDataState } from '@/lib/db/courses-queries';
import { formatCourseLabel } from '@/lib/courses/parse-course-code';
import { partitionRosterRows } from '@/lib/courses/group-by-scope-status';
import { CourseClassControls } from './CourseClassControls';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

interface Props {
  rows: CourseStatusRow[];
  rosterRows: CourseRosterRow[];
  slug: string;
  pairedByCode: Record<string, Array<{ pairedCode: string }>>;
  snapshotCountByCode: Map<string, number>;
  /** What-ifs with a page, per course code. */
  whatIfCountByCode?: Map<string, number>;
}

// ─── Status pill config ────────────────────────────────────────────────────

type PillConfig = {
  label: string;
  className: string;
};

const STATUS_CONFIG: Record<CaptureStatus, PillConfig> = {
  captured:     { label: 'Captured',    className: 'cs-cue-done' },
  reviewed:     { label: 'Reviewed',    className: 'cs-cue-read' },
  'ai-drafted': { label: 'AI drafted',  className: 'cs-cue-draft' },
  'in-audit':   { label: 'In audit',    className: 'cs-cue-input' },
  'not-started':{ label: 'Not started', className: 'cs-cue-none' },
};

// ─── Data-state badge config ───────────────────────────────────────────────

type DataStateBadgeConfig = {
  label: string;
  className: string;
};

const DATA_STATE_CONFIG: Record<CourseDataState, DataStateBadgeConfig> = {
  measured: { label: 'Measured', className: 'cs-cue-read' },
  intended: { label: 'Syllabus', className: 'cs-cue-draft' },
  'no-data': { label: 'No data', className: 'cs-cue-none' },
};

function DataStateBadge({ state }: { state: CourseDataState }) {
  const { label, className } = DATA_STATE_CONFIG[state];
  return (
    <span
      className={`cs-cue ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function levelLabel(level: number | null): string {
  if (level === null) return 'Other';
  return `${level}000-level`;
}

// Group rows by level, preserving the pre-sorted order.
function groupByLevel(rows: CourseStatusRow[]): Map<number | null, CourseStatusRow[]> {
  const groups = new Map<number | null, CourseStatusRow[]>();
  for (const row of rows) {
    const key = row.level;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

// ─── Status pill ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status: CaptureStatus }) {
  const { label, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`cs-cue ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Counter bar ──────────────────────────────────────────────────────────

function StatusCounters({ rows }: { rows: CourseStatusRow[] }) {
  const counts: Record<CaptureStatus, number> = {
    captured: 0,
    reviewed: 0,
    'ai-drafted': 0,
    'in-audit': 0,
    'not-started': 0,
  };
  for (const r of rows) counts[r.status]++;

  const parts: Array<{ label: string; n: number; color: string }> = [
    { label: 'captured',    n: counts['captured'],     color: 'cs-cue-done' },
    { label: 'reviewed',    n: counts['reviewed'],     color: 'cs-cue-read' },
    { label: 'drafted',     n: counts['ai-drafted'],   color: 'cs-cue-draft' },
    { label: 'in audit',    n: counts['in-audit'],     color: 'cs-cue-input' },
    { label: 'not started', n: counts['not-started'],  color: 'cs-cue-none' },
  ];

  return (
    <div className="cs-counters">
      {parts.map((p) => (
        <span key={p.label} className={`cs-cue ${p.color}`}>
          <span className="cs-cue-count">{p.n}</span> {p.label}
        </span>
      ))}
    </div>
  );
}

// ─── Course row ───────────────────────────────────────────────────────────

export function CourseRow({
  row,
  slug,
  dataState,
  pairedCodes,
  versionCount = 0,
  whatIfCount = 0,
}: {
  row: CourseStatusRow;
  slug: string;
  index?: number;
  dataState?: CourseDataState;
  pairedCodes: Array<{ pairedCode: string }>;
  versionCount?: number;
  whatIfCount?: number;
}) {
  const captureHref = `/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const whatIfsHref = `/explore/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const viewHref = `/view/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const historyHref = `/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}&panel=history`;
  // Task 8 will build the course detail page — link target is /courses/[code]
  const prereqHref = `/courses/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const isStarted = row.status !== 'not-started';
  const primaryLabel = isStarted ? 'Edit Course' : 'Capture Course';

  return (
    <div
      data-testid={`course-row-${row.code}`}
      className="cs-course"
    >
      {/* Main row link — capture is the primary action */}
      <Link href={captureHref} className="cs-course-main">
        {/* Course code */}
        <span className="cs-course-code">
          {formatCourseLabel(row.code, pairedCodes)}
        </span>

        {/* Title */}
        <span className="cs-course-title">
          {row.title}
        </span>

        {/* Data-state badge (prereq analysis context) */}
        {dataState && (
          <span className="cs-slot-data">
            <DataStateBadge state={dataState} />
          </span>
        )}

        {/* Status pill */}
        <span className="cs-slot-status">
          <StatusPill status={row.status} />
        </span>

        {/* Last captured date */}
        <span className="cs-course-date">
          {row.lastCapturedAt ? formatDate(row.lastCapturedAt) : ''}
        </span>

        {/* State-dependent primary action label + arrow */}
        <span className="cs-course-act">{primaryLabel} →</span>
      </Link>

      <div className="cs-course-side">
        {/* View Course — only when course has been started */}
        {isStarted && (
          <Link href={viewHref} className="cs-link">
            View Course
          </Link>
        )}

        {/* What-ifs: the course's list of sketched changes, with a count when there are any */}
        <Link
          href={whatIfsHref}
          className="cs-link"
          title={WHAT_IF_COPY.linkTitle}
        >
          {WHAT_IF_COPY.linkLabel(whatIfCount)}
        </Link>

        {/* N versions — only when snapshots exist */}
        {versionCount > 0 && (
          <Link href={historyHref} className="cs-link cs-link-quiet">
            {versionCount} versions
          </Link>
        )}

        {/* Prereq view link — demoted, unchanged */}
        <Link
          href={prereqHref}
          className="cs-link cs-link-quiet"
          title="View prerequisite edges for this course"
        >
          Prereqs
        </Link>

        <CourseClassControls
          code={row.code}
          slug={slug}
          category={row.category}
          buildsToCareer={row.buildsToCareer}
          catalogUrl={row.catalogUrl}
        />
      </div>
    </div>
  );
}

// ─── Level group ──────────────────────────────────────────────────────────

function LevelGroup({
  level,
  rows,
  slug,
  startIndex,
  dataStateByCode,
  pairedByCode,
  snapshotCountByCode,
  whatIfCountByCode,
}: {
  level: number | null;
  rows: CourseStatusRow[];
  slug: string;
  startIndex: number;
  dataStateByCode: Map<string, CourseDataState>;
  pairedByCode: Record<string, Array<{ pairedCode: string }>>;
  snapshotCountByCode: Map<string, number>;
  whatIfCountByCode?: Map<string, number>;
}) {
  return (
    <div className="cs-group">
      {/* Group header */}
      <div className="cs-group-head">
        <span className="cs-label">
          {levelLabel(level)}
        </span>
        <span className="cs-group-rule" />
        <span className="cs-group-count">
          {rows.length}
        </span>
      </div>

      {/* Rows */}
      <div className="cs-list">
        {rows.map((row) => (
          <CourseRow
            key={row.code}
            row={row}
            slug={slug}
            dataState={dataStateByCode.get(row.code)}
            pairedCodes={pairedByCode[row.code] ?? []}
            versionCount={snapshotCountByCode.get(row.code) ?? 0}
            whatIfCount={whatIfCountByCode?.get(row.code) ?? 0}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function CoursesIndex({ rows, rosterRows, slug, pairedByCode, snapshotCountByCode, whatIfCountByCode }: Props) {
  // Build a lookup map: code → dataState from the roster query
  const dataStateByCode = new Map<string, CourseDataState>(
    rosterRows.map((r) => [r.code, r.dataState]),
  );

  // Segregate non-GC / non-offered courses out of the main level-grouped roster
  // into their own sections (External/sandbox, Proposed). gc = scope gc + offered.
  const partition = partitionRosterRows(rows);
  const groups = groupByLevel(partition.gc);

  let globalIndex = 0;
  const groupEntries = Array.from(groups.entries());

  return (
    <div>
      {/* Status counters — reflect the GC roster (the segregated sections are separate) */}
      <StatusCounters rows={partition.gc} />

      {/* Column header (wide screens only) */}
      <div className="cs-colhead" aria-hidden="true">
        <span className="cs-label cs-hc-code">Code</span>
        <span className="cs-label cs-hc-title">Title</span>
        <span className="cs-label cs-hc-data">Data</span>
        <span className="cs-label cs-hc-status">Status</span>
        <span className="cs-label cs-hc-date">Last captured</span>
        <span className="cs-label cs-hc-act" />
        <span className="cs-label cs-hc-side" />
      </div>

      {/* Groups */}
      {groupEntries.map(([level, levelRows]) => {
        const start = globalIndex;
        globalIndex += levelRows.length;
        return (
          <LevelGroup
            key={String(level)}
            level={level}
            rows={levelRows}
            slug={slug}
            startIndex={start}
            dataStateByCode={dataStateByCode}
            pairedByCode={pairedByCode}
            snapshotCountByCode={snapshotCountByCode}
            whatIfCountByCode={whatIfCountByCode}
          />
        );
      })}

      {/* Segregated sections — shown only when non-empty (populated via the
          external-access / proposed-course flows; both are separate plans). */}
      {partition.proposed.length > 0 && (
        <section className="cs-group">
          <div className="cs-group-head cs-group-head--proposed">
            <h2 className="cs-label">Proposed · test the waters</h2>
            <span className="cs-group-rule" />
          </div>
          <div className="cs-list">
          {partition.proposed.map((row) => (
            <CourseRow
              key={row.code}
              row={row}
              slug={slug}
              dataState={dataStateByCode.get(row.code)}
              pairedCodes={pairedByCode[row.code] ?? []}
              versionCount={snapshotCountByCode.get(row.code) ?? 0}
            whatIfCount={whatIfCountByCode?.get(row.code) ?? 0}
            />
          ))}
          </div>
        </section>
      )}
      {partition.external.length > 0 && (
        <section className="cs-group">
          <div className="cs-group-head">
            <h2 className="cs-label">External / sandbox</h2>
            <span className="cs-group-rule" />
          </div>
          <div className="cs-list">
          {partition.external.map((row) => (
            <CourseRow
              key={row.code}
              row={row}
              slug={slug}
              dataState={dataStateByCode.get(row.code)}
              pairedCodes={pairedByCode[row.code] ?? []}
              versionCount={snapshotCountByCode.get(row.code) ?? 0}
            whatIfCount={whatIfCountByCode?.get(row.code) ?? 0}
            />
          ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="cs-center">
          <p className="cs-body">No courses in the catalog yet.</p>
          <p className="cs-meta mt-2">
            Use &ldquo;Preload courses&rdquo; above to add your roster.
          </p>
        </div>
      )}
    </div>
  );
}
