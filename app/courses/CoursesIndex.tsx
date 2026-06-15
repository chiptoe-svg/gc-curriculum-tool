'use client';

import Link from 'next/link';
import type { CourseStatusRow, CaptureStatus } from '@/lib/db/capture-status-queries';
import type { CourseRosterRow, CourseDataState } from '@/lib/db/courses-queries';
import { formatCourseLabel } from '@/lib/courses/parse-course-code';
import { partitionRosterRows } from '@/lib/courses/group-by-scope-status';
import { CourseRosterControls } from './CourseRosterControls';
import { CourseClassControls } from './CourseClassControls';

interface Props {
  rows: CourseStatusRow[];
  rosterRows: CourseRosterRow[];
  slug: string;
  pairedByCode: Record<string, Array<{ pairedCode: string }>>;
}

// ─── Status pill config ────────────────────────────────────────────────────

type PillConfig = {
  label: string;
  className: string;
};

const STATUS_CONFIG: Record<CaptureStatus, PillConfig> = {
  captured:     { label: 'Captured',    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  reviewed:     { label: 'Reviewed',    className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  'ai-drafted': { label: 'AI drafted',  className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  'in-audit':   { label: 'In audit',    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  'not-started':{ label: 'Not started', className: 'bg-stone-100 text-stone-600 dark:bg-stone-800/40 dark:text-stone-400' },
};

// ─── Data-state badge config ───────────────────────────────────────────────

type DataStateBadgeConfig = {
  label: string;
  className: string;
};

const DATA_STATE_CONFIG: Record<CourseDataState, DataStateBadgeConfig> = {
  measured: {
    label: 'Measured',
    className: 'bg-violet-100 text-violet-800 border border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700',
  },
  intended: {
    // Reserved for rough-pass increment — amber/syllabus style
    label: 'Syllabus',
    className: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
  },
  'no-data': {
    label: 'No data',
    className: 'bg-transparent text-muted-foreground/50 border border-border/50',
  },
};

function DataStateBadge({ state }: { state: CourseDataState }) {
  const { label, className } = DATA_STATE_CONFIG[state];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[9px] uppercase tracking-[0.18em] font-medium ${className}`}
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.18em] font-medium ${className}`}
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
    { label: 'captured',    n: counts['captured'],     color: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'reviewed',    n: counts['reviewed'],     color: 'text-teal-700 dark:text-teal-400' },
    { label: 'drafted',     n: counts['ai-drafted'],   color: 'text-amber-700 dark:text-amber-400' },
    { label: 'in audit',    n: counts['in-audit'],     color: 'text-blue-700 dark:text-blue-400' },
    { label: 'not started', n: counts['not-started'],  color: 'text-stone-500 dark:text-stone-400' },
  ];

  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1">
      {parts.map((p, i) => (
        <span key={p.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/40 select-none">·</span>}
          <span className={`font-body-sans text-[10px] uppercase tracking-[0.18em] font-medium ${p.color}`}>
            <span className="tabular-nums">{p.n}</span> {p.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Course row ───────────────────────────────────────────────────────────

function CourseRow({
  row,
  slug,
  index,
  dataState,
  pairedCodes,
}: {
  row: CourseStatusRow;
  slug: string;
  index: number;
  dataState?: CourseDataState;
  pairedCodes: Array<{ pairedCode: string }>;
}) {
  const captureHref = `/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const askHref = `/explore/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}&tab=ask`;
  // Task 8 will build the course detail page — link target is /courses/[code]
  const prereqHref = `/courses/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`;
  const delay = Math.min(index * 30, 600); // cap stagger at 600ms

  return (
    <div
      className="group relative flex items-center gap-4 rounded-md transition-colors hover:bg-muted/40 animate-in fade-in slide-in-from-bottom-1"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {/* Main row link — capture is the primary action */}
      <Link href={captureHref} className="flex flex-1 items-center gap-4 px-3 py-3">
        {/* Course code */}
        <span className="w-28 shrink-0 font-mono-plex text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {formatCourseLabel(row.code, pairedCodes)}
        </span>

        {/* Title */}
        <span className="flex-1 font-display text-[1.0625rem] font-medium leading-snug tracking-tight">
          {row.title}
        </span>

        {/* Data-state badge (prereq analysis context) */}
        {dataState && (
          <span className="shrink-0">
            <DataStateBadge state={dataState} />
          </span>
        )}

        {/* Status pill */}
        <span className="shrink-0">
          <StatusPill status={row.status} />
        </span>

        {/* Last captured date */}
        <span className="w-32 shrink-0 text-right font-mono-plex text-[10px] text-muted-foreground/70">
          {row.lastCapturedAt ? formatDate(row.lastCapturedAt) : ''}
        </span>

        {/* Arrow */}
        <span className="shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </Link>

      {/* Prereq view link — Task 8 builds the actual view at /courses/[code] */}
      <Link
        href={prereqHref}
        className="shrink-0 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        title="View prerequisite edges for this course"
      >
        Prereqs
      </Link>

      {/* Ask affordance — separate Link so the chat tab deep-links cleanly */}
      <Link
        href={askHref}
        className="shrink-0 pr-3 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
        title="Ask the curriculum chat about this course (anchored here, but ranges across the whole program)"
      >
        💬 Ask
      </Link>
      <CourseClassControls
        code={row.code}
        slug={slug}
        category={row.category}
        buildsToCareer={row.buildsToCareer}
        catalogUrl={row.catalogUrl}
      />
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
}: {
  level: number | null;
  rows: CourseStatusRow[];
  slug: string;
  startIndex: number;
  dataStateByCode: Map<string, CourseDataState>;
  pairedByCode: Record<string, Array<{ pairedCode: string }>>;
}) {
  return (
    <div className="mb-6">
      {/* Group header */}
      <div className="mb-1 flex items-center gap-3">
        <span className="font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 font-medium select-none">
          {levelLabel(level)}
        </span>
        <span className="flex-1 border-t border-border/40" />
        <span className="font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40 tabular-nums select-none">
          {rows.length}
        </span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/20">
        {rows.map((row, i) => (
          <CourseRow
            key={row.code}
            row={row}
            slug={slug}
            index={startIndex + i}
            dataState={dataStateByCode.get(row.code)}
            pairedCodes={pairedByCode[row.code] ?? []}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function CoursesIndex({ rows, rosterRows, slug, pairedByCode }: Props) {
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
      {/* Roster controls (preload + add-a-course) */}
      <CourseRosterControls slug={slug} />

      {/* Status counters — reflect the GC roster (the segregated sections are separate) */}
      <StatusCounters rows={partition.gc} />

      {/* Column header */}
      <div className="mb-2 flex items-center gap-4 px-3">
        <span className="w-28 shrink-0 font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          Code
        </span>
        <span className="flex-1 font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          Title
        </span>
        <span className="shrink-0 font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          Data
        </span>
        <span className="shrink-0 font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          Status
        </span>
        <span className="w-32 shrink-0 text-right font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
          Last captured
        </span>
        {/* prereqs + ask + arrow spacer */}
        <span className="shrink-0 w-4" />
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
          />
        );
      })}

      {/* Segregated sections — shown only when non-empty (populated via the
          external-access / proposed-course flows; both are separate plans). */}
      {partition.proposed.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 px-3 font-body-sans text-[10px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
            Proposed · test the waters
          </h2>
          {partition.proposed.map((row, i) => (
            <CourseRow
              key={row.code}
              row={row}
              slug={slug}
              index={globalIndex + i}
              dataState={dataStateByCode.get(row.code)}
              pairedCodes={pairedByCode[row.code] ?? []}
            />
          ))}
        </section>
      )}
      {partition.external.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 px-3 font-body-sans text-[10px] uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">
            External / sandbox
          </h2>
          {partition.external.map((row, i) => (
            <CourseRow
              key={row.code}
              row={row}
              slug={slug}
              index={globalIndex + partition.proposed.length + i}
              dataState={dataStateByCode.get(row.code)}
              pairedCodes={pairedByCode[row.code] ?? []}
            />
          ))}
        </section>
      )}

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <p className="font-body-sans text-sm">No courses in the catalog yet.</p>
          <p className="mt-2 font-body-sans text-xs text-muted-foreground/60">
            Use &ldquo;Preload courses&rdquo; above to add your roster.
          </p>
        </div>
      )}
    </div>
  );
}
