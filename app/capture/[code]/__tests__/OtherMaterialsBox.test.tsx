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
} as unknown as CourseCatalogView;

function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: o.id ?? 'm', fileName: o.fileName ?? 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1,
    pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: o.extractedText ?? 'x',
    ignored: o.ignored ?? false, digest: null, digestGeneratedAt: null, useDigest: false,
    indexingStatus: o.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'low', autoSetAside: false,
    setAsideReason: o.setAsideReason ?? null, blobUrl: o.blobUrl ?? '', ignoredItems: o.ignoredItems, ...o,
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

  it('Scan linked docs POSTs to scan-linked-docs and refreshes', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({})]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ referenced: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /scan linked docs/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toContain('/scan-linked-docs');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('ignore on a row PATCHes the material with {ignored:true}', async () => {
    const onMaterialsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OtherMaterialsBox course={course} materials={others} slug="s" onMaterialsChange={onMaterialsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /other materials/i }));
    // ignore the first upload row
    const ignoreButtons = screen.getAllByRole('button', { name: /ignore/i });
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
});
