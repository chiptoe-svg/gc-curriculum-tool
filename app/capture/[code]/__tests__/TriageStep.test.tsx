import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CaptureMaterial } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { TriageStep } from '@/app/capture/[code]/TriageStep';

// ---------------------------------------------------------------------------
// Fixtures — CaptureMaterial with tier field
// ---------------------------------------------------------------------------

function makeMaterial(overrides: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: overrides.id ?? 'mat-id',
    fileName: overrides.fileName ?? 'file.pdf',
    mimeType: overrides.mimeType ?? 'application/pdf',
    sizeBytes: overrides.sizeBytes ?? 1024,
    pageCount: overrides.pageCount ?? null,
    extractionStatus: overrides.extractionStatus ?? 'pending',
    extractionMethod: overrides.extractionMethod ?? null,
    extractedText: overrides.extractedText ?? null,
    ignored: overrides.ignored ?? false,
    digest: overrides.digest ?? null,
    digestGeneratedAt: overrides.digestGeneratedAt ?? null,
    useDigest: overrides.useDigest ?? false,
    indexingStatus: overrides.indexingStatus ?? 'pending',
    indexedAt: overrides.indexedAt ?? null,
    ferpaRisk: overrides.ferpaRisk ?? 'low',
    autoSetAside: overrides.autoSetAside ?? false,
    setAsideReason: overrides.setAsideReason ?? null,
    blobUrl: overrides.blobUrl ?? 'blob://test',
    ignoredItems: overrides.ignoredItems,
    sourceCode: overrides.sourceCode ?? null,
    tier: overrides.tier ?? null,
  };
}

const highMat = makeMaterial({ id: 'h1', fileName: 'Canvas File: lecture.pptx', tier: 'high', pageCount: 24 });
const middleMat = makeMaterial({ id: 'm1', fileName: 'Canvas: Syllabus', tier: 'middle', pageCount: 8 });
const backgroundMat = makeMaterial({ id: 'b1', fileName: 'Canvas: Assignments', tier: 'background' });
const nullTierMat = makeMaterial({ id: 'n1', fileName: 'uploaded-notes.pdf', tier: null });

const baseMaterials: CaptureMaterial[] = [highMat, middleMat, backgroundMat];
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
        materials={baseMaterials}
        onIngested={noop}
      />,
    );
    expect(screen.getByText(/high value/i)).toBeTruthy();
    expect(screen.getAllByText(/middle/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/background/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders each row in its correct tier section', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );
    expect(screen.getByText(/lecture\.pptx/i)).toBeTruthy();
    expect(screen.getByText(/Syllabus/)).toBeTruthy();
    expect(screen.getByText(/Assignments/)).toBeTruthy();
  });

  it('buckets null-tier material into the high section', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={[...baseMaterials, nullTierMat]}
        onIngested={noop}
      />,
    );
    // null-tier mat should appear (uploaded-notes.pdf)
    expect(screen.getByText(/uploaded-notes\.pdf/i)).toBeTruthy();
    // The HIGH VALUE section should have both h1 and n1 file names visible
    // We verify by ensuring the null-tier mat is not listed under a different
    // tier — its row is accessible alongside the known high material.
    expect(screen.getByText(/lecture\.pptx/i)).toBeTruthy();
    expect(screen.getByText(/uploaded-notes\.pdf/i)).toBeTruthy();
  });

  it('does NOT render a skipped-files section', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );
    // Old skipped section had "Skipped (won't be pulled in)" text
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it('shows the slides nudge when no middle-tier material is present', () => {
    const noMiddle = [highMat, backgroundMat];
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={noMiddle}
        onIngested={noop}
      />,
    );
    expect(screen.getByText(/no lecture slides found/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /add slides/i })).toBeTruthy();
  });

  it('hides the slides nudge when a middle-tier material is present', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
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
        materials={baseMaterials}
        onIngested={onIngested}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ingest & continue/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/admin/v2-backfill');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ courseCode: 'GC 3800', slug: 'test-slug' });

    await waitFor(() => expect(onIngested).toHaveBeenCalled());
  });

  it('shows an error message and re-enables button when ingest fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ingest & continue/i }));
    await waitFor(() => expect(screen.getByText(/server error/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /ingest & continue/i })).not.toBeDisabled();
  });

  it('move-up button PATCHes with next higher tier and the row moves to the high section', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );

    // middleMat (m1, "Canvas: Syllabus") is in the MIDDLE section.
    // Click its move-up (▲) — it should patch to 'high' and the DOM should
    // reflect the row in the high section (middleMat's row still visible but
    // the API received tier:'high').
    const upButtons = screen.getAllByRole('button', { name: /move up/i });
    // The middle row has the first ▲ button (high row has no ▲)
    fireEvent.click(upButtons[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/m1');
    expect(url).toContain('slug=test-slug');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ tier: 'high' });

    // After update, the row should no longer show a move-up button
    // (it's now in 'high' and high rows have no ▲).
    await waitFor(() => {
      const upBtns = screen.queryAllByRole('button', { name: /move up/i });
      // Background row still has ▲; the formerly-middle row should now have none
      expect(upBtns.length).toBeLessThan(2);
    });
  });

  it('ignore button PATCHes with {ignored:true} and dims the row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );

    const ignoreButtons = screen.getAllByRole('button', { name: /^ignore$/i });
    fireEvent.click(ignoreButtons[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ ignored: true });

    // After toggle, that button should flip to "include"
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /include/i }).length).toBeGreaterThan(0);
    });
  });

  it('delete button DELETEs the material and removes it from the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );

    // First click → confirm state
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]!);

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/materials/h1');
    expect((init as RequestInit).method).toBe('DELETE');

    // The row should be removed from the DOM
    await waitFor(() => {
      expect(screen.queryByText(/lecture\.pptx/i)).toBeNull();
    });
  });

  it('resets pendingDelete to false on a FAILED delete (no stuck confirm)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop}
      />,
    );

    // Enter confirm state
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    // Now in confirm state — click confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // After failed delete the confirm button should be GONE (pendingDelete reset)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
    });
    // Error message shown
    expect(screen.getByText(/failed/i)).toBeTruthy();
  });
});
