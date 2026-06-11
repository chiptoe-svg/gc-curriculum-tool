import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  IndexingStatusDot: () => <span data-testid="dot" />,
}));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CanvasBox } from '@/app/capture/[code]/boxes/CanvasBox';

const course = {
  code: 'GC 3800', title: 'Junior Seminar', description: '', prerequisites: '',
  learningObjectives: [], majorProjects: [], skillsRequired: [], auditMode: 'full',
} as unknown as CourseCatalogView;

function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: o.id ?? 'm', fileName: o.fileName ?? 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1,
    pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: o.extractedText ?? 'x',
    ignored: o.ignored ?? false, digest: null, digestGeneratedAt: null, useDigest: false,
    indexingStatus: o.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'low' as never,
    autoSetAside: false, setAsideReason: o.setAsideReason ?? null, blobUrl: '', ignoredItems: o.ignoredItems, ...o,
  } as CaptureMaterial;
}

const noop = () => {};
beforeEach(() => { vi.restoreAllMocks(); });

describe('CanvasBox', () => {
  it('collapsed summary shows the item count (parsed items + files) and readiness', () => {
    const blob = '## Assignment One\nbody\n## Assignment Two\nbody\n## Assignment Three\nbody';
    const materials = [
      mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: blob, indexingStatus: 'ready' }),
      mat({ id: 'f', fileName: 'Canvas File: rubric.pdf', indexingStatus: 'pending' }),
    ];
    render(<CanvasBox course={course} materials={materials} slug="s" onMaterialsChange={noop} />);
    // 3 parsed items + 1 Canvas File = 4 items
    expect(screen.getByText(/4 items/)).toBeTruthy();
    // worst readiness across the two materials is the pending file ("not indexed yet")
    expect(screen.getByText(/not indexed yet/i)).toBeTruthy();
  });

  it('unrolling lists the parsed Canvas-list item titles', () => {
    const blob = '## Assignment One\nbody\n## Assignment Two\nbody';
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: blob })]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    expect(screen.getByText('Assignment One')).toBeTruthy();
    expect(screen.getByText('Assignment Two')).toBeTruthy();
  });

  it('labels the Canvas syllabus material "(syllabus)" when unrolled', () => {
    render(<CanvasBox course={course} materials={[mat({ id: 'syl', fileName: 'Canvas: Syllabus', extractedText: 'no headers here' })]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    expect(screen.getByText(/\(syllabus\)/i)).toBeTruthy();
  });

  it('toggling a per-item ignore checkbox PATCHes the material', async () => {
    const blob = '## Assignment One\nbody\n## Assignment Two\nbody';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: blob })]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/materials/');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toHaveProperty('ignoredItems');
  });

  it('Index now POSTs v2-backfill then refetches materials', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({ id: 'f', fileName: 'Canvas File: rubric.pdf', indexingStatus: 'ready' })]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasBox course={course} materials={[mat({ id: 'f', fileName: 'Canvas File: rubric.pdf', indexingStatus: 'pending' })]} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /index now/i }));
    await waitFor(() => expect(fetchMock.mock.calls[0]![0]).toContain('/v2-backfill'));
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('no Index now button when nothing is fixably unindexed', () => {
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## One\nb', indexingStatus: 'ready' })]} slug="s" onMaterialsChange={noop} />);
    expect(screen.queryByRole('button', { name: /index now/i })).toBeNull();
  });

  it('Import/Reimport opens a Canvas token field and POSTs canvas-reextract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'application/json' }, json: async () => ({ updated: 1, skipped: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## One\nb' })]} slug="s" onMaterialsChange={noop} />);
    // open the token field
    fireEvent.click(screen.getByRole('button', { name: /reimport|import from canvas/i }));
    const tokenField = screen.getByLabelText(/canvas api token/i);
    fireEvent.change(tokenField, { target: { value: 'tok_abc' } });
    // submit
    const region = tokenField.closest('div')!;
    fireEvent.click(within(region).getByRole('button', { name: /import|reimport|go|submit/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/canvas-reextract');
  });
});
