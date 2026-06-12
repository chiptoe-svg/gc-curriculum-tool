/**
 * MaterialsPanel hideRows tests — Item B (Round 8).
 *
 * When hideRows=true, the panel renders:
 *   - the section header (bulk-op buttons: Regenerate AI summaries, Scan linked
 *     files, Import from Canvas)
 *   - the token chip / warnings (header level)
 *   - a one-line note "Per-material controls … live in the three source boxes above."
 *
 * It does NOT render:
 *   - the per-material row list (<ul id="materials-list"> / individual filenames)
 *
 * The chat stage passes hideRows=false (default), so the row list renders normally.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

// CanvasImportZone is heavy; mock it so the panel renders in isolation.
vi.mock('@/components/CanvasImportZone', () => ({
  CanvasImportZone: () => null,
}));
vi.mock('@/lib/capture/fetch-course-materials', () => ({
  fetchCourseMaterials: vi.fn(),
}));

import { MaterialsPanel } from '@/app/capture/[code]/MaterialsPanel';

const course: CourseCatalogView = {
  code: 'GC 3800',
  title: 'Junior Seminar',
  description: 'A course',
  prerequisites: '',
  learningObjectives: ['x', 'y'],
  majorProjects: [],
  skillsRequired: [],
  auditMode: 'full',
  canvasCourseName: null,
  canvasImportedAt: null,
};

function mat(o: Partial<CaptureMaterial> = {}): CaptureMaterial {
  return {
    id: o.id ?? 'm1',
    fileName: o.fileName ?? 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: null,
    extractionStatus: 'ok',
    extractionMethod: null,
    extractedText: 'hello world',
    ignored: false,
    digest: null,
    digestGeneratedAt: null,
    useDigest: false,
    indexingStatus: 'ready',
    indexedAt: null,
    ferpaRisk: 'low',
    autoSetAside: false,
    setAsideReason: null,
    blobUrl: '',
    ...o,
  } as CaptureMaterial;
}

const materials = [mat({ id: 'a', fileName: 'syllabus.pdf' }), mat({ id: 'b', fileName: 'rubric.pdf' })];

describe('MaterialsPanel — hideRows', () => {
  it('hideRows=false (default): renders per-material rows', () => {
    render(
      <MaterialsPanel
        course={course}
        initialMaterials={materials}
        slug="s"
        initiallyExpanded
        hideRows={false}
      />,
    );
    // Both filenames visible in the row list
    expect(screen.getByText('syllabus.pdf')).toBeTruthy();
    expect(screen.getByText('rubric.pdf')).toBeTruthy();
    // The note should NOT appear
    expect(screen.queryByText(/per-material controls/i)).toBeNull();
  });

  it('hideRows=true: does not render per-material rows, shows the note', () => {
    render(
      <MaterialsPanel
        course={course}
        initialMaterials={materials}
        slug="s"
        initiallyExpanded
        hideRows
      />,
    );
    // Individual filenames should not appear (row list hidden)
    expect(screen.queryByText('syllabus.pdf')).toBeNull();
    expect(screen.queryByText('rubric.pdf')).toBeNull();
    // The explanatory note should appear
    expect(screen.getByText(/per-material controls/i)).toBeTruthy();
  });

  it('hideRows=true: bulk-op buttons still render', () => {
    render(
      <MaterialsPanel
        course={course}
        initialMaterials={materials}
        slug="s"
        initiallyExpanded
        hideRows
      />,
    );
    // These live in the materials inner-header, always rendered regardless of hideRows
    expect(screen.getByRole('button', { name: /regenerate ai summaries/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scan linked files/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /import from canvas/i })).toBeTruthy();
  });
});
