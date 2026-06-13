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
  canvasCourseName: null, canvasImportedAt: null, pairedCodes: [],
} as unknown as CourseCatalogView;

function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: o.id ?? 'm', fileName: o.fileName ?? 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1,
    pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: o.extractedText ?? 'x',
    ignored: o.ignored ?? false, digest: null, digestGeneratedAt: null, useDigest: false,
    indexingStatus: o.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'low' as never,
    autoSetAside: false, setAsideReason: o.setAsideReason ?? null, blobUrl: '', ignoredItems: o.ignoredItems,
    sourceCode: null, ...o,
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

  it('Canvas box header shows course name and import datestamp when canvasImportedAt is set', () => {
    const courseWithImport = {
      ...course,
      canvasCourseName: 'S2405-GC-3800 Junior Seminar',
      canvasImportedAt: '2026-06-03T18:00:00Z',
    } as unknown as CourseCatalogView;
    render(<CanvasBox course={courseWithImport} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## One\nb', indexingStatus: 'ready' })]} slug="s" onMaterialsChange={noop} />);
    expect(screen.getByText(/S2405-GC-3800 Junior Seminar/)).toBeTruthy();
    // The date portion is locale-formatted; just assert the word "imported" appears
    // and the course name is present — exact date string depends on the test TZ.
    expect(screen.getByText(/imported \d+\/\d+\/\d+/)).toBeTruthy();
  });

  it('Scan linked docs POSTs to scan-linked-docs and refetches', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({})]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## One\nb' })]} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /scan linked docs/i }));
    await waitFor(() => expect(fetchMock.mock.calls[0]![0]).toContain('/scan-linked-docs'));
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('ignored Canvas: Syllabus row shows the why-not-used line', () => {
    const syllabus = mat({
      id: 'syl',
      fileName: 'Canvas: Syllabus',
      extractedText: 'Syllabus content here.',
      ignored: true,
      autoSetAside: true,
      setAsideReason: null,
    });
    render(<CanvasBox course={course} materials={[syllabus]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    expect(screen.getByText(/not used — the Google Sheet catalog already provides/i)).toBeTruthy();
  });

  it('canvas header shows total points when assignments have point values', () => {
    // Two assignments: 100 pts + 50 pts = 150 total pts
    const blob = '## Assignment One (100 pts)\ndescription one\n## Assignment Two (50 pts)\ndescription two';
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: blob, indexingStatus: 'ready' })]} slug="s" onMaterialsChange={noop} />);
    expect(screen.getByText(/150 total pts/)).toBeTruthy();
  });

  it('unrolled assignment item with a rubric shows a rubric ✓ chip', () => {
    const blob = '## Assignment One (100 pts)\ndescription\n\nRubric — Main:\n- Criterion A (10 pts)\n\n## Assignment Two (50 pts)\ndescription only';
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: blob })]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    // Assignment One has rubric — chip visible
    expect(screen.getByText(/rubric ✓/i)).toBeTruthy();
    // Only one chip (Assignment Two has no rubric)
    expect(screen.getAllByText(/rubric ✓/i)).toHaveLength(1);
  });

  it('renders per-page import slots + groups items by source when paired codes exist', () => {
    const courseB = { ...course, code: 'GC 3460', pairedCodes: [{ pairedCode: 'GC 3461', role: 'lab', canvasImportedAt: null }] } as unknown as CourseCatalogView;
    render(<CanvasBox course={courseB} materials={[
      mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## X (10 pts)', sourceCode: null }),
      mat({ id: 'b', fileName: 'Canvas: Assignments', extractedText: '## Y (5 pts)', sourceCode: 'GC 3461' }),
    ]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    expect(screen.getByText(/lab/i)).toBeTruthy();                 // the lab slot/subheader
    expect(screen.getAllByRole('button', { name: /scan linked docs/i })).toHaveLength(1); // footer action once
  });

  it('slot import in bundled mode POSTs to /canvas-import with canvasUrl + sourceCode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ imported: 3, inserted: 3, updated: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const courseB = {
      ...course, code: 'GC 3460',
      pairedCodes: [{ pairedCode: 'GC 3461', role: 'lab', canvasImportedAt: null }],
    } as unknown as CourseCatalogView;
    render(<CanvasBox course={courseB} materials={[
      mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## X', sourceCode: null }),
      mat({ id: 'b', fileName: 'Canvas: Assignments', extractedText: '## Y', sourceCode: 'GC 3461' }),
    ]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));

    // Open the Lab slot's form
    const importButtons = screen.getAllByRole('button', { name: /^import$|^reimport$/i });
    // The lab slot header Import button is the second one (primary is first)
    const labImportBtn = importButtons[1]!;
    fireEvent.click(labImportBtn);

    // Fill in canvas URL for the lab slot
    const urlField = screen.getByLabelText(/canvas course url/i);
    fireEvent.change(urlField, { target: { value: 'https://clemson.instructure.com/courses/99999' } });

    // Fill in token
    const tokenField = screen.getByLabelText(/canvas api token/i);
    fireEvent.change(tokenField, { target: { value: 'tok_lab' } });

    // Submit — click the last Import/Reimport button rendered (the one inside the open form)
    const allImportBtns = screen.getAllByRole('button', { name: /^import$|^reimport$/i });
    fireEvent.click(allImportBtns[allImportBtns.length - 1]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Must hit canvas-import, not canvas-reextract
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain('/canvas-import');
    expect(calledUrl).not.toContain('reextract');

    // Body must include canvasUrl and sourceCode
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toHaveProperty('canvasUrl');
    expect(String(body.canvasUrl)).toContain('clemson.instructure.com');
    expect(body).toHaveProperty('sourceCode', 'GC 3461');
  });

  it('materials with an unmatched sourceCode still render under an Unmatched source subheader', () => {
    const courseB = {
      ...course, code: 'GC 3460',
      pairedCodes: [{ pairedCode: 'GC 3461', role: 'lab', canvasImportedAt: null }],
    } as unknown as CourseCatalogView;
    // GC 9999 is NOT in pairedCodes — it's an orphan
    render(<CanvasBox course={courseB} materials={[
      mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## X', sourceCode: null }),
      mat({ id: 'b', fileName: 'Canvas: Assignments', extractedText: '## Y', sourceCode: 'GC 3461' }),
      mat({ id: 'c', fileName: 'Canvas: Pages', extractedText: '## Orphan', sourceCode: 'GC 9999' }),
    ]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    // The orphan subheader must appear
    expect(screen.getByText(/unmatched source.*GC 9999/i)).toBeTruthy();
    // The orphan material itself must render
    expect(screen.getByText('Canvas: Pages')).toBeTruthy();
  });

  it('renders today\'s single-import layout when there are no paired codes', () => {
    const courseN = { ...course, pairedCodes: [] } as unknown as CourseCatalogView;
    render(<CanvasBox course={courseN} materials={[mat({ fileName: 'Canvas: Assignments', extractedText: '## X', sourceCode: null })]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
    expect(screen.queryByText(/lab page|lecture page/i)).toBeNull(); // no per-page slots
  });

  it('auto-scan checkbox is checked by default and triggers scan-linked-docs after import', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({})]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ updated: 2, skipped: 0 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasBox course={course} materials={[mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## One\nb' })]} slug="s" onMaterialsChange={onMaterialsChange} />);
    // Open token field
    fireEvent.click(screen.getByRole('button', { name: /reimport|import from canvas/i }));
    // Confirm checkbox is checked by default
    const checkbox = screen.getByRole('checkbox', { name: /scan linked/i });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    // Fill token and submit
    const tokenField = screen.getByLabelText(/canvas api token/i);
    fireEvent.change(tokenField, { target: { value: 'tok_abc' } });
    const { within: withinFn } = await import('@testing-library/react');
    fireEvent.click(withinFn(tokenField.closest('div')!.parentElement!).getAllByRole('button').find(b => /import|reimport/i.test(b.textContent ?? ''))!);
    // Both canvas-reextract and scan-linked-docs should be called
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const urls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some(u => u.includes('/canvas-reextract'))).toBe(true);
    expect(urls.some(u => u.includes('/scan-linked-docs'))).toBe(true);
    // Assert order: canvas-reextract first
    expect(urls.indexOf(urls.find(u => u.includes('/canvas-reextract'))!))
      .toBeLessThan(urls.indexOf(urls.find(u => u.includes('/scan-linked-docs'))!));
  });
});
