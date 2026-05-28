'use client';

import { useMemo } from 'react';
import type { CaptureMaterial } from './MaterialsPanel';

/**
 * Inspector panel for Canvas-imported content. Two purposes:
 *  1. Show which Canvas categories (Syllabus, Assignments, Module List,
 *     Pages, Discussions, Quizzes, Files) were imported vs. absent.
 *     A "Quizzes — absent" row tells faculty their course had no quizzes
 *     in Canvas, not that the import dropped them.
 *  2. For the Canvas: Assignments material specifically, parse the
 *     structured text dump into a per-assignment table with rubric
 *     indicator. Faculty want to see "which assignments have rubrics"
 *     without scrolling the raw extracted text.
 *
 * Pure client-side parsing of material.extractedText — no server call.
 * The text format is defined by app/api/courses/[code]/canvas-import/route.ts.
 */

interface AssignmentRow {
  name: string;
  points: number | null;
  hasRubric: boolean;
}

interface CanvasCategory {
  fileName: string;
  label: string;
  description: string;
}

const CANVAS_CATEGORIES: CanvasCategory[] = [
  { fileName: 'Canvas: Syllabus', label: 'Syllabus', description: 'The Canvas syllabus page body.' },
  { fileName: 'Canvas: Assignments', label: 'Assignments', description: 'All assignments with descriptions, points, and rubric criteria.' },
  { fileName: 'Canvas: Module List', label: 'Module List', description: 'Course module structure with item titles and types.' },
  { fileName: 'Canvas: Pages', label: 'Pages', description: 'Canvas Pages (wiki-style course pages).' },
  { fileName: 'Canvas: Discussions', label: 'Discussions', description: 'Discussion topics, including graded ones.' },
  { fileName: 'Canvas: Quizzes', label: 'Quizzes', description: 'Quizzes with questions, answers, and point values.' },
];

/**
 * Parse the Canvas: Assignments extractedText into a row per assignment.
 *
 * The text format is determined by canvas-import/route.ts:118-148. Each
 * assignment renders as:
 *
 *   ## Assignment Name (N pts)
 *   <description body, HTML-stripped>
 *   <blank line>
 *   Rubric — Title:           (or "Rubric:" if no title)
 *   - Criterion (N pts) — long description
 *     ratings: N pts: label / N pts: label / ...
 *
 * Blocks are separated by `\n\n`. We split on `\n## ` (handling the
 * first block which doesn't have a leading newline) and pick off the
 * title line + rubric-presence marker.
 */
function parseAssignments(extractedText: string): AssignmentRow[] {
  const text = extractedText.startsWith('## ') ? extractedText.slice(3) : extractedText;
  const blocks = text.split(/\n## /);
  const rows: AssignmentRow[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    const firstLine = lines[0] ?? '';
    const titleMatch = firstLine.match(/^(.*?)(?:\s*\((\d+(?:\.\d+)?)\s*pts\))?\s*$/);
    if (!titleMatch) continue;
    const name = (titleMatch[1] ?? firstLine).trim();
    const points = titleMatch[2] ? parseFloat(titleMatch[2]) : null;
    const body = lines.slice(1).join('\n');
    const hasRubric = /(^|\n)Rubric(?:\s+—\s+[^:]+)?:/.test(body);
    rows.push({ name, points, hasRubric });
  }
  return rows;
}

interface Props {
  materials: CaptureMaterial[];
}

export function CanvasImportSummary({ materials }: Props) {
  const byName = useMemo(
    () => new Map(materials.map(m => [m.fileName, m])),
    [materials],
  );
  const canvasFileCount = useMemo(
    () => materials.filter(m => m.fileName.startsWith('Canvas File:')).length,
    [materials],
  );
  const assignmentsMaterial = byName.get('Canvas: Assignments');
  const assignmentRows = useMemo(
    () => assignmentsMaterial?.extractedText ? parseAssignments(assignmentsMaterial.extractedText) : [],
    [assignmentsMaterial?.extractedText],
  );
  const rubricCount = assignmentRows.filter(r => r.hasRubric).length;

  // Hide the panel entirely when the course has no Canvas-imported content
  // (e.g., a course populated only from Google Drive or manual uploads).
  const anyCanvasContent = CANVAS_CATEGORIES.some(c => byName.has(c.fileName)) || canvasFileCount > 0;
  if (!anyCanvasContent) return null;

  return (
    <details className="group rounded-md border bg-sky-50/40 px-4 py-3">
      <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-foreground select-none">
        <span>
          <span className="mr-1.5 text-sky-700">▤</span>
          What was imported from Canvas
        </span>
        <span className="text-xs text-muted-foreground group-open:hidden">click to expand</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">click to collapse</span>
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed">

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Categories checked
          </h4>
          <ul className="space-y-1 pl-1">
            {CANVAS_CATEGORIES.map(cat => {
              const material = byName.get(cat.fileName);
              const ignored = material?.ignored ?? false;
              const present = !!material;
              const dotClass = !present
                ? 'text-muted-foreground'
                : ignored
                  ? 'text-amber-600'
                  : 'text-emerald-600';
              const status = !present
                ? 'no content in Canvas (or not pulled in this import)'
                : ignored
                  ? 'imported but currently ignored'
                  : 'imported';
              return (
                <li key={cat.fileName} className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-block w-4 shrink-0 text-center ${dotClass}`}>
                    {present ? '●' : '○'}
                  </span>
                  <div className="flex-1">
                    <span className="font-medium">{cat.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">— {status}</span>
                    <p className="text-[11px] text-muted-foreground">{cat.description}</p>
                  </div>
                </li>
              );
            })}
            <li className="flex items-start gap-2">
              <span className={`mt-0.5 inline-block w-4 shrink-0 text-center ${canvasFileCount > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {canvasFileCount > 0 ? '●' : '○'}
              </span>
              <div className="flex-1">
                <span className="font-medium">Files</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  — {canvasFileCount > 0 ? `${canvasFileCount} attached file${canvasFileCount === 1 ? '' : 's'}` : 'no files attached'}
                </span>
                <p className="text-[11px] text-muted-foreground">PDFs, DOCX, PPTX, XLSX, and other files attached to assignments or pages.</p>
              </div>
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            A gray dot means that Canvas category was either not present or returned no content during the last import. If you have content there in Canvas and don&apos;t see it here, click <em>Import from Canvas</em> at the top of the Materials panel to re-sync. Amber dots mean the material was imported but is currently being skipped during the audit (see the &ldquo;why ignored&rdquo; note on that row).
          </p>
        </section>

        {assignmentRows.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assignments ({assignmentRows.length}) — {rubricCount} with rubric{rubricCount === 1 ? '' : 's'} attached
            </h4>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Assignment</th>
                    <th className="px-2 py-1.5 text-right font-medium">Points</th>
                    <th className="px-2 py-1.5 text-center font-medium">Rubric</th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentRows.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {row.points !== null ? row.points : '—'}
                      </td>
                      <td className={`px-2 py-1.5 text-center ${row.hasRubric ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}`}>
                        {row.hasRubric ? '✓' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The audit agent retrieves assignment descriptions and rubric criteria via its search tools. Rubric criteria are what faculty actually grade against — they ground the depth-rating questions the agent will ask. Assignments without rubrics get scored from their description text alone, which gives the agent less to work with.
            </p>
          </section>
        )}

      </div>
    </details>
  );
}
