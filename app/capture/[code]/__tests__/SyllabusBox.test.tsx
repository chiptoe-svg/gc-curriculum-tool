import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { SyllabusBox } from '../boxes/SyllabusBox';
import type { CaptureMaterial, CourseCatalogView } from '../MaterialsPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn(async () => null) }));

const { uploadFileWithProgress } = vi.hoisted(() => ({ uploadFileWithProgress: vi.fn() }));
vi.mock('@/lib/capture/upload-with-progress', () => ({ uploadFileWithProgress }));

const COURSE: CourseCatalogView = {
  code: 'GC 1040',
  title: 'Intro',
  description: 'A course about printing.',
  prerequisites: 'GC 0000',
  learningObjectives: ['Identify the press components', 'Explain color theory'],
  majorProjects: ['Poster'],
  skillsRequired: ['typing'],
  auditMode: 'full',
  canvasCourseName: null,
  canvasImportedAt: null,
  pairedCodes: [],
};

const M = (fileName: string, over: Partial<CaptureMaterial> = {}): CaptureMaterial =>
  ({
    id: fileName,
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    pageCount: 1,
    extractionStatus: 'ready',
    extractionMethod: null,
    extractedText: '',
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
    sourceCode: null,
    ...over,
  }) as CaptureMaterial;

function Harness({
  course = COURSE,
  catalogSyncedAt = null,
  materials = [],
  triageEnabled = false,
}: {
  course?: CourseCatalogView;
  catalogSyncedAt?: string | null;
  materials?: CaptureMaterial[];
  triageEnabled?: boolean;
}) {
  const [c, setC] = useState(course);
  const [mats, setMats] = useState(materials);
  return (
    <SyllabusBox
      course={c}
      catalogSyncedAt={catalogSyncedAt}
      materials={mats}
      slug="s1"
      onCourseChange={setC}
      onMaterialsChange={setMats}
      triageEnabled={triageEnabled}
    />
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SyllabusBox', () => {
  it('collapsed status reflects a synced sheet', () => {
    render(<Harness catalogSyncedAt={new Date(Date.now() - 2 * 86_400_000).toISOString()} />);
    expect(screen.getByText(/synced/i)).toBeTruthy();
    expect(screen.getByText(/Re-sync/i)).toBeTruthy();
  });

  it('collapsed status reflects an attached syllabus when no sheet sync', () => {
    render(<Harness materials={[M('syllabus.pdf', { isSyllabus: true })]} />);
    expect(screen.getByText(/syllabus\.pdf attached/i)).toBeTruthy();
  });

  it('collapsed status reflects an empty slot prompting to add a syllabus', () => {
    render(<Harness />);
    expect(screen.getByText(/add a syllabus/i)).toBeTruthy();
  });

  it('unroll shows a learning objective from the catalog', () => {
    render(<Harness catalogSyncedAt={new Date().toISOString()} />);
    expect(screen.queryByText('Explain color theory')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Syllabus & course info/i }));
    expect(screen.getByText('Explain color theory')).toBeTruthy();
  });

  it('Re-sync POSTs to a sync-from-sheet URL', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ course: { lastSyncedAt: new Date().toISOString() } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<Harness catalogSyncedAt={new Date().toISOString()} />);
    fireEvent.click(screen.getByRole('button', { name: /Re-sync/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/sync-from-sheet');
  });

  it('shows a differ-warning when both a sheet catalog and an attached syllabus are present', () => {
    render(
      <Harness
        catalogSyncedAt={new Date().toISOString()}
        materials={[M('syllabus.pdf', { isSyllabus: true })]}
      />,
    );
    expect(screen.getByText(/a different syllabus is also attached/i)).toBeTruthy();
  });

  it('shows not-in-sheet status when catalogSyncedAt is set but all catalog fields are empty', () => {
    const emptyCourse: CourseCatalogView = {
      ...COURSE,
      description: '',
      prerequisites: '',
      learningObjectives: [],
      majorProjects: [],
      skillsRequired: [],
    };
    render(
      <Harness
        course={emptyCourse}
        catalogSyncedAt={new Date().toISOString()}
      />,
    );
    // Must NOT show "synced" — that would be the false-stamp bug
    expect(screen.queryByText(/synced/i)).toBeNull();
    // Must show the correct not-in-sheet message
    expect(screen.getByText(/not in the Google Sheet/i)).toBeTruthy();
    // Re-sync button stays available so faculty can try again
    expect(screen.getByText(/Re-sync/i)).toBeTruthy();
  });

  it('names an attached syllabus even when the course is not in the sheet', () => {
    const emptyCourse: CourseCatalogView = {
      ...COURSE, description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [],
    };
    render(
      <Harness
        course={emptyCourse}
        catalogSyncedAt={new Date().toISOString()}
        materials={[M('MKT 4320 Simple Syllabus.pdf', { isSyllabus: true })]}
      />,
    );
    expect(screen.getByText(/MKT 4320 Simple Syllabus\.pdf attached/)).toBeTruthy();
    expect(screen.queryByText(/not in the Google Sheet/i)).toBeNull();
  });

  it('notes a Canvas syllabus is available when present', () => {
    render(
      <Harness
        catalogSyncedAt={new Date().toISOString()}
        materials={[M('Canvas: Syllabus')]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Syllabus & course info/i }));
    expect(screen.getByText(/a Canvas syllabus is also available/i)).toBeTruthy();
  });

  it('button label is "Replace syllabus" when sheet catalog is synced with content', () => {
    render(<Harness catalogSyncedAt={new Date().toISOString()} />);
    expect(screen.getByRole('button', { name: /replace syllabus/i })).toBeTruthy();
  });

  it('button label is "Attach a syllabus" when no sheet catalog', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /attach a syllabus/i })).toBeTruthy();
  });

  it('recognises the syllabus by its flag, not its file name', () => {
    render(<Harness materials={[M('syllabus.pdf'), M('course outline.pdf', { isSyllabus: true })]} />);
    expect(screen.getByText(/course outline\.pdf attached/i)).toBeTruthy();
    expect(screen.queryByText(/^— syllabus\.pdf attached/i)).toBeNull();
  });

  it('shows the required notice until a syllabus exists', () => {
    const { unmount } = render(<Harness catalogSyncedAt={new Date().toISOString()} />);
    expect(screen.getByText('Add the course syllabus: import it from Canvas or upload it here.')).toBeTruthy();
    unmount();
    render(<Harness materials={[M('Canvas: Syllabus', { isSyllabus: true })]} />);
    expect(screen.queryByText(/Add the course syllabus/)).toBeNull();
  });

  it('lists each recognised syllabus with its readiness', () => {
    render(
      <Harness
        triageEnabled
        materials={[
          M('outline.pdf', { isSyllabus: true, indexingStatus: 'pending' }),
          M('Canvas: Syllabus', { isSyllabus: true, indexingStatus: 'ready' }),
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: /syllabus materials/i });
    expect(list.textContent).toContain('outline.pdf');
    expect(list.textContent).toContain('attached — will be read when you ingest');
    expect(list.textContent).toContain('Canvas: Syllabus');
    expect(list.textContent).toContain('ready');
  });

  it('offers Include anyway on a FERPA set-aside syllabus and PATCHes ignored:false', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(
      <Harness
        materials={[M('MKT 4320 syllabus.pdf', {
          id: 'syl-1', isSyllabus: true, ignored: true, autoSetAside: true, ferpaRisk: 'high',
          setAsideReason: 'FERPA risk detected (emails) — set aside automatically',
        })]}
      />,
    );
    expect(screen.getByText(/FERPA risk detected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Include anyway' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/materials/syl-1?slug=s1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).body).toBe(JSON.stringify({ ignored: false }));
  });

  it('uploads through the box as the syllabus (role=syllabus)', async () => {
    uploadFileWithProgress.mockResolvedValue({ ok: true, status: 200, json: {} });
    const { container } = render(<Harness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'outline.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalled());
    expect(uploadFileWithProgress.mock.calls[0]![0]).toMatchObject({ role: 'syllabus' });
  });
});
