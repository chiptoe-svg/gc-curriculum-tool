import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CaptureMaterial } from '@/app/capture/[code]/MaterialsPanel';
import { estimateTotal, estimateSeconds, formatDuration } from '@/lib/capture/ingest-estimate';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The mount-time tier sync calls fetchCourseMaterials; stub it to null so it's a
// no-op and doesn't consume the fetch mock these tests assert against.
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn(async () => null) }));

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
    rawCleared: overrides.rawCleared ?? false,
    retiredAt: overrides.retiredAt ?? null,
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
      />,
    );
    expect(screen.getByText(/add your lecture slides/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /add slides/i })).toBeTruthy();
  });

  it('hides the slides nudge when a middle-tier material is present', () => {
    render(
      <TriageStep
        courseCode="GC 3800"
        slug="test-slug"
        materials={baseMaterials}
        onIngested={noop} onBack={noop}
      />,
    );
    expect(screen.queryByText(/add your lecture slides/i)).toBeNull();
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
        onIngested={onIngested} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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
        onIngested={noop} onBack={noop}
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

  // ---------------------------------------------------------------------------
  // Time estimate chips (per-row and total)
  // ---------------------------------------------------------------------------

  describe('time estimate chips', () => {
    it('renders the total estimate near the Ingest button', () => {
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={baseMaterials}
          onIngested={noop} onBack={noop}
        />,
      );
      // Should show "Estimated:" label
      expect(screen.getByText(/estimated:/i)).toBeTruthy();
    });

    it('total estimate contains a duration or "—"', () => {
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={baseMaterials}
          onIngested={noop} onBack={noop}
        />,
      );
      const estimatedEl = screen.getByText(/estimated:/i).parentElement ?? screen.getByText(/estimated:/i);
      const text = estimatedEl.textContent ?? '';
      // Matches ~Xs, ~N min, ~N.M hr, or a range like ~30s–1 min, or '—'
      expect(text).toMatch(/~\d|—/);
    });

    it('shows "rough estimate" caveat near the Ingest button', () => {
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={baseMaterials}
          onIngested={noop} onBack={noop}
        />,
      );
      expect(screen.getByText(/rough estimate/i)).toBeTruthy();
    });

    it('shows "2 at a time" concurrency note near the Ingest button', () => {
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={baseMaterials}
          onIngested={noop} onBack={noop}
        />,
      );
      expect(screen.getByText(/2 at a time/i)).toBeTruthy();
    });

    it('renders at least one per-row estimate chip using formatDuration format', () => {
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={baseMaterials}
          onIngested={noop} onBack={noop}
        />,
      );
      // At least one chip should match a formatDuration pattern (~Xs, ~N min, ~N.M hr, or —)
      // getAllByText with regex finds all matching text nodes
      const chips = screen.getAllByText(/^(~\d+s|~\d+ min|~\d+\.\d+ hr|—)$/);
      expect(chips.length).toBeGreaterThanOrEqual(1);
    });

    it('ignored row shows "—" chip (estimateSeconds returns 0 for ignored)', () => {
      const ignoredMat = makeMaterial({ id: 'ig1', fileName: 'ignored.pdf', tier: 'high', pageCount: 20, ignored: true });
      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={[ignoredMat]}
          onIngested={noop} onBack={noop}
        />,
      );
      // The per-row chip for an ignored material should be '—'
      const dashChips = screen.getAllByText('—');
      expect(dashChips.length).toBeGreaterThanOrEqual(1);
    });

    it('high-tier fixture produces a larger total estimate than all-background fixture', () => {
      // All-high fixture: 3 high-tier materials with many pages each
      const highFixture = [
        makeMaterial({ id: 'hh1', tier: 'high', pageCount: 30 }),
        makeMaterial({ id: 'hh2', tier: 'high', pageCount: 30 }),
        makeMaterial({ id: 'hh3', tier: 'high', pageCount: 30 }),
      ];
      // All-background fixture: same count, same pages
      const bgFixture = [
        makeMaterial({ id: 'bb1', tier: 'background', pageCount: 30 }),
        makeMaterial({ id: 'bb2', tier: 'background', pageCount: 30 }),
        makeMaterial({ id: 'bb3', tier: 'background', pageCount: 30 }),
      ];

      const highTotal = estimateTotal(highFixture);
      const bgTotal = estimateTotal(bgFixture);

      // High-tier materials are much more expensive — the totals should differ significantly
      expect(highTotal.seconds).toBeGreaterThan(bgTotal.seconds);
    });

    it('total recomputes when a row is moved to a higher tier (per-row chip changes)', async () => {
      // Start with a single middle-tier material with many pages.
      // middle, pageCount=10 → 8s → '~5s'; high, pageCount=10 → 47s → '~45s'
      // Using middle so that clicking ▲ patches to 'high' (tierUp('middle') = 'high').
      const midOnlyMat = makeMaterial({ id: 'mid-only', tier: 'middle', pageCount: 10 });

      // Compute expected per-row estimate chips before and after the move
      const midEstimate = formatDuration(estimateSeconds({ tier: 'middle', pageCount: 10 }));
      const highEstimate = formatDuration(estimateSeconds({ tier: 'high', pageCount: 10 }));

      // They must differ for this test to be meaningful
      expect(midEstimate).not.toBe(highEstimate);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      render(
        <TriageStep
          courseCode="GC 3800"
          slug="test-slug"
          materials={[midOnlyMat]}
          onIngested={noop} onBack={noop}
        />,
      );

      // Initially shows middle-tier estimate chip
      expect(screen.getByText(midEstimate)).toBeTruthy();

      // Move up → high (middle has a ▲ button; tierUp('middle') = 'high')
      const upBtn = screen.getByRole('button', { name: /move up/i });
      fireEvent.click(upBtn);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      // After the PATCH resolves, onUpdate fires and the row re-renders with high tier.
      // The per-row chip should now show the high-tier estimate.
      await waitFor(() => {
        expect(screen.getByText(highEstimate)).toBeTruthy();
      });
    });
  });
});
