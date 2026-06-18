import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  IndexingStatusDot: () => <span data-testid="dot" />,
}));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { OtherMaterialsBox } from '@/app/capture/[code]/boxes/OtherMaterialsBox';

const course = {
  code: 'GC 3800', title: 'Junior Seminar', description: 'A course', prerequisites: '',
  learningObjectives: ['x', 'y'], majorProjects: [], skillsRequired: [], auditMode: 'full',
  canvasCourseName: null, canvasImportedAt: null,
} as unknown as CourseCatalogView;

function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: o.id ?? 'm', fileName: o.fileName ?? 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
    pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: o.extractedText ?? 'hello world',
    ignored: o.ignored ?? false, digest: o.digest ?? null, digestGeneratedAt: null, useDigest: o.useDigest ?? false,
    indexingStatus: o.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'low', autoSetAside: false,
    setAsideReason: o.setAsideReason ?? null, blobUrl: o.blobUrl ?? '', ignoredItems: o.ignoredItems,
    sourceCode: null, ...o,
  } as CaptureMaterial;
}

const noop = () => {};
beforeEach(() => { vi.restoreAllMocks(); });

// Two uploads + three linked docs (mixed kinds).
const others = [
  mat({ id: 'u1', fileName: 'handout.pdf' }),
  mat({ id: 'u2', fileName: 'rubric.docx' }),
  mat({ id: 'l1', fileName: 'YouTube: Lecture', blobUrl: 'https://youtu.be/abc' }),
  mat({ id: 'l2', fileName: 'Drive PDF: Spec', blobUrl: 'https://drive.google.com/x' }),
  mat({ id: 'l3', fileName: 'Google Doc: Notes', blobUrl: 'https://docs.google.com/y' }),
];

describe('OtherMaterialsBox', () => {
  it('collapsed shows counts by provenance type', () => {
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={noop} />);
    // collapsed summary: "2 uploads · 3 linked"
    expect(screen.getByText(/2 uploads/)).toBeTruthy();
    expect(screen.getByText(/3 linked/)).toBeTruthy();
    // rows are not shown until unrolled
    expect(screen.queryByText('handout.pdf')).toBeNull();
  });

  it('unrolls to per-material rows with provenance badges and source links', () => {
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    expect(screen.getByText('handout.pdf')).toBeTruthy();
    expect(screen.getByText('YouTube: Lecture')).toBeTruthy();
    // linked docs render a source ↗ link to their blobUrl (one per linked doc)
    const links = screen.getAllByRole('link', { name: /source/i });
    expect(links).toHaveLength(3);
    expect(links[0]!.getAttribute('href')).toBe('https://youtu.be/abc');
  });

  it('has no scan button — scan linked docs lives in the Canvas box now', () => {
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={noop} />);
    expect(screen.queryByRole('button', { name: /scan/i })).toBeNull();
  });

  it('ignore on a row PATCHes the material with {ignored:true}', async () => {
    const onMaterialsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    // ignore the first upload row
    const ignoreButtons = screen.getAllByRole('button', { name: /^ignore$/i });
    fireEvent.click(ignoreButtons[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/u1');
    expect(init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(init.body as string)).toMatchObject({ ignored: true });
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('Index now appears for a fixably-unindexed row and POSTs v2-backfill', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({})]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OtherMaterialsBox course={course} materials={[mat({ id: 'p1', fileName: 'pending.pdf', indexingStatus: 'pending' })]} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    fireEvent.click(screen.getByRole('button', { name: /index now/i }));
    await waitFor(() => expect(fetchMock.mock.calls[0]![0]).toContain('/v2-backfill'));
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  // ── New parity tests (Round 3) ──────────────────────────────────────────

  it('AI-summary checkbox PATCHes {useDigest:true} for a row that has a digest', async () => {
    const onMaterialsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const withDigest = [mat({ id: 'd1', fileName: 'report.pdf', digest: 'summarized text', useDigest: false })];
    render(<OtherMaterialsBox course={course} materials={withDigest} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    // AI summary checkbox must be rendered
    const cb = screen.getByRole('checkbox', { name: /ai summary/i });
    expect(cb).toBeTruthy();
    fireEvent.click(cb);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/d1');
    expect(JSON.parse(init.body as string)).toMatchObject({ useDigest: true });
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('"interview sends ~N tok" note shows when useDigest && digest', () => {
    const withDigest = [mat({ id: 'd2', fileName: 'notes.pdf', digest: 'x'.repeat(400), useDigest: true })];
    render(<OtherMaterialsBox course={course} materials={withDigest} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    expect(screen.getByText(/interview sends ~/i)).toBeTruthy();
  });

  it('preview button expands extractedText and hide collapses it', () => {
    const m = mat({ id: 'p2', fileName: 'hand.pdf', extractedText: 'visible content here' });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    // text hidden before expand
    expect(screen.queryByText(/visible content here/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    expect(screen.getByText(/visible content here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^hide$/i }));
    expect(screen.queryByText(/visible content here/)).toBeNull();
  });

  it('delete button DELETEs the material and removes it from the list', async () => {
    const onMaterialsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const mats = [mat({ id: 'del1', fileName: 'toDelete.pdf' }), mat({ id: 'keep', fileName: 'keep.pdf' })];
    render(<OtherMaterialsBox course={course} materials={mats} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButtons[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/del1');
    expect((init as RequestInit).method).toBe('DELETE');
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
    // The callback should filter out del1
    const next = (onMaterialsChange.mock.calls[0] as [CaptureMaterial[]])[0];
    expect(next.find((x) => x.id === 'del1')).toBeUndefined();
    expect(next.find((x) => x.id === 'keep')).toBeTruthy();
  });

  // ── FERPA include-anyway + why-ignored (Item B, Round 8) ────────────────

  it('autoSetAside row shows why-ignored reason and Include anyway button', () => {
    const m = mat({
      id: 'ferpa1',
      fileName: 'gradebook.xlsx',
      autoSetAside: true,
      ignored: true,
      setAsideReason: 'Contains student IDs — FERPA risk',
    });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));

    // Reason text visible
    expect(screen.getByText(/contains student ids/i)).toBeTruthy();
    // Include anyway button visible
    expect(screen.getByRole('button', { name: /include anyway/i })).toBeTruthy();
  });

  it('overridden FERPA row (autoSetAside, not ignored) looks normal — no why-ignored band', () => {
    const m = mat({
      id: 'ferpaOverridden',
      fileName: 'gradebook.xlsx',
      autoSetAside: true,
      ignored: false,
      setAsideReason: 'Contains student IDs — FERPA risk',
    });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    // No FERPA reason band and no "Include anyway" once overridden.
    expect(screen.queryByText(/contains student ids/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /include anyway/i })).toBeNull();
  });

  it('triageEnabled hides the indexing status + Index now affordance', () => {
    const m = mat({ id: 'pending1', fileName: 'late.pdf', indexingStatus: 'pending' });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={() => {}} triageEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    expect(screen.queryByText(/not indexed yet/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^index now$/i })).toBeNull();
  });

  it('autoSetAside row without setAsideReason falls back to default text', () => {
    const m = mat({
      id: 'ferpa2',
      fileName: 'roster.pdf',
      autoSetAside: true,
      ignored: true,
      setAsideReason: null,
    });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    expect(screen.getByText(/set aside automatically/i)).toBeTruthy();
  });

  it('Include anyway PATCHes {ignored:false} and updates materials list optimistically', async () => {
    const onMaterialsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const m = mat({ id: 'ferpa3', fileName: 'attendance.pdf', autoSetAside: true, ignored: true });
    render(<OtherMaterialsBox course={course} materials={[m]} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));

    const btn = screen.getByRole('button', { name: /include anyway/i });
    fireEvent.click(btn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/ferpa3');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ ignored: false });

    // onMaterialsChange called with ignored:false optimistically
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
    const next = (onMaterialsChange.mock.calls[0] as [CaptureMaterial[]])[0];
    expect(next.find((x) => x.id === 'ferpa3')?.ignored).toBe(false);
  });
});
