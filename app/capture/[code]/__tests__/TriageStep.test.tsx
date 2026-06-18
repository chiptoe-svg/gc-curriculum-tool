import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ManifestRow, SkippedFile } from '@/app/api/courses/[code]/canvas-import/list-import';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { TriageStep } from '@/app/capture/[code]/TriageStep';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ManifestRow>): ManifestRow {
  return {
    id: overrides.id ?? 'row-id',
    fileName: overrides.fileName ?? 'file.pdf',
    kind: overrides.kind ?? 'file',
    mimeType: overrides.mimeType ?? 'application/pdf',
    sizeBytes: overrides.sizeBytes ?? 1024,
    pageCount: overrides.pageCount,
    slideCount: overrides.slideCount,
    indexingStatus: overrides.indexingStatus ?? 'pending',
    tier: overrides.tier ?? 'background',
  };
}

const highRow = makeRow({ id: 'h1', fileName: 'Canvas File: lecture.pptx', tier: 'high', slideCount: 24 });
const middleRow = makeRow({ id: 'm1', fileName: 'Canvas: Syllabus', kind: 'syllabus', tier: 'middle', pageCount: 8 });
const backgroundRow = makeRow({ id: 'b1', fileName: 'Canvas: Assignments', kind: 'assignments', tier: 'background' });

const skipped: SkippedFile[] = [
  { fileName: 'logo.png', mimeType: 'image/png', reason: 'unsupported type: image/png' },
];

const baseManifest = {
  rows: [highRow, middleRow, backgroundRow],
  skipped,
  decksPresent: false,
};

const noop = () => {};

beforeEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriageStep', () => {
  it('renders the three tier section headers', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );
    // HIGH VALUE only appears in the section header
    expect(screen.getByText(/high value/i)).toBeTruthy();
    // "MIDDLE" as a standalone header text (mono-caps span)
    expect(screen.getAllByText(/middle/i).length).toBeGreaterThanOrEqual(1);
    // BACKGROUND only appears in the section header
    expect(screen.getAllByText(/background/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders each row in its correct tier section', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );
    // All three rows visible
    expect(screen.getByText(/lecture\.pptx/i)).toBeTruthy();
    expect(screen.getByText(/Syllabus/)).toBeTruthy();
    expect(screen.getByText(/Assignments/)).toBeTruthy();
  });

  it('renders the skipped file line', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );
    expect(screen.getByText(/logo\.png/)).toBeTruthy();
  });

  it('shows the slides nudge when no middle rows AND decksPresent=false', () => {
    const noMiddleManifest = {
      rows: [highRow, backgroundRow],
      skipped: [],
      decksPresent: false,
    };
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={noMiddleManifest}
        onIngested={noop}
      />,
    );
    expect(screen.getByText(/no lecture slides found/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /add slides/i })).toBeTruthy();
  });

  it('does NOT show the slides nudge when a middle row is present', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );
    expect(screen.queryByText(/no lecture slides found/i)).toBeNull();
  });

  it('does NOT show the slides nudge when decksPresent=true even without middle rows', () => {
    const decksNoMiddle = {
      rows: [highRow, backgroundRow],
      skipped: [],
      decksPresent: true,
    };
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={decksNoMiddle}
        onIngested={noop}
      />,
    );
    expect(screen.queryByText(/no lecture slides found/i)).toBeNull();
  });

  it('clicking Ingest & continue POSTs to /api/admin/v2-backfill and calls onIngested', async () => {
    const onIngested = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ queued: 3 }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={onIngested}
      />,
    );

    const btn = screen.getByRole('button', { name: /ingest & continue/i });
    fireEvent.click(btn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/admin/v2-backfill');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ courseCode: 'GC 3800', slug: 'test-slug' });

    await waitFor(() => expect(onIngested).toHaveBeenCalled());
  });

  it('shows an error message and re-enables button when ingest fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'server error' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ingest & continue/i }));
    // The component shows the error string from the response body
    await waitFor(() => expect(screen.getByText(/server error/i)).toBeTruthy());
    // Button should be re-enabled after error
    expect(screen.getByRole('button', { name: /ingest & continue/i })).not.toBeDisabled();
  });

  it('move-up button PATCHes with next higher tier and updates UI', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );

    // middleRow has both ▲ and ▼; click ▲ to move to high
    const upButtons = screen.getAllByRole('button', { name: /move up/i });
    fireEvent.click(upButtons[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/m1');
    expect(url).toContain('slug=test-slug');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ tier: 'high' });
  });

  it('ignore button PATCHes with {ignored:true} and dims the row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );

    const ignoreButtons = screen.getAllByRole('button', { name: /^ignore$/i });
    fireEvent.click(ignoreButtons[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ ignored: true });
  });

  it('delete button DELETEs the material and removes it from the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        manifest={baseManifest}
        onIngested={noop}
      />,
    );

    // Confirm-then-delete: click delete to confirm prompt
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    // First click opens confirm
    fireEvent.click(deleteButtons[0]!);
    // Confirm button appears
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/h1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
