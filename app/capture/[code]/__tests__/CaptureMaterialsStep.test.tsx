import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-panel-detail">detail</div>,
  IndexingStatusDot: () => <span data-testid="dot" />,
}));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CaptureMaterialsStep } from '@/app/capture/[code]/CaptureMaterialsStep';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: 'A course', prerequisites: '', learningObjectives: ['x','y'], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;
function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return { id:o.id??'m', fileName:o.fileName??'f.pdf', mimeType:'application/pdf', sizeBytes:1, pageCount:null, extractionStatus:'ok', extractionMethod:null, extractedText:o.extractedText??'x', ignored:o.ignored??false, digest:null, digestGeneratedAt:null, useDigest:false, indexingStatus:o.indexingStatus??'ready', indexedAt:null, ferpaRisk:'ok' as never, autoSetAside:false, setAsideReason:o.setAsideReason??null, blobUrl:'', ignoredItems:o.ignoredItems, ...o } as CaptureMaterial;
}
const noop = () => {};
beforeEach(() => { vi.restoreAllMocks(); });

describe('CaptureMaterialsStep v2', () => {
  it('shows the GC curriculum sheet catalog row with a contribution summary', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText('GC curriculum catalog')).toBeTruthy();
    expect(screen.getByText('GC curriculum sheet')).toBeTruthy();
    expect(screen.getByText(/description · 2 learning objectives/)).toBeTruthy();
  });

  it('Re-sync POSTs sync-from-sheet and updates the course', async () => {
    const onCourseChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ course: { description: 'new', learningObjectives: ['a'], prerequisites: '', majorProjects: [], skillsRequired: [], lastSyncedAt: new Date().toISOString() } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={onCourseChange} onContinue={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /re-sync/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toContain('/sync-from-sheet');
    await waitFor(() => expect(onCourseChange).toHaveBeenCalled());
  });

  it('marks a pending material not-readable and shows Index now', async () => {
    const onMaterialsChange = vi.fn();
    const { fetchCourseMaterials } = await import('@/lib/capture/fetch-course-materials');
    (fetchCourseMaterials as ReturnType<typeof vi.fn>).mockResolvedValue([mat({ indexingStatus: 'ready' })]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CaptureMaterialsStep course={course} materials={[mat({ fileName: 'doc.pdf', indexingStatus: 'pending' })]} slug="s" catalogSyncedAt={null} onMaterialsChange={onMaterialsChange} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText(/not indexed yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /index now/i }));
    await waitFor(() => expect(fetchMock.mock.calls[0]![0]).toContain('/v2-backfill'));
    await waitFor(() => expect(onMaterialsChange).toHaveBeenCalled());
  });

  it('no Index now button when nothing is fixably unindexed', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({ indexingStatus: 'ready' })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByRole('button', { name: /index now/i })).toBeNull();
  });

  it('unrolls a Canvas-list material to its item titles', () => {
    const blob = '## Assignment One\nbody\n## Assignment Two\nbody';
    render(<CaptureMaterialsStep course={course} materials={[mat({ fileName: 'Canvas: Assignments', extractedText: blob })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /expand items/i }));
    expect(screen.getByText('Assignment One')).toBeTruthy();
    expect(screen.getByText('Assignment Two')).toBeTruthy();
  });
});
