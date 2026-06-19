/**
 * CaptureClient triage-step wiring tests.
 *
 * These verify that:
 * 1. With the `triageEnabled` prop true, clicking Continue from the materials
 *    step renders TriageStep (not the interview).
 * 2. With `triageEnabled` false, clicking Continue goes directly to the
 *    interview step (unchanged flag-off behavior).
 * 3. TriageStep's onIngested transitions to the interview.
 *
 * The flag is read server-side (page.tsx → isTriageEnabled) and passed as the
 * `triageEnabled` prop; this client component never reads process.env directly
 * (it can't — non-NEXT_PUBLIC env vars aren't in the browser bundle).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock heavy sub-components so we're only testing wiring.
vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({
  CaptureMaterialsStep: ({ onContinue }: { onContinue: () => void }) => (
    <div data-testid="materials-step">
      <button onClick={onContinue}>Continue</button>
    </div>
  ),
}));
vi.mock('@/app/capture/[code]/TriageStep', () => ({
  TriageStep: ({ onIngested }: { onIngested: () => void }) => (
    <div data-testid="triage-step">
      <button onClick={onIngested}>Ingested</button>
    </div>
  ),
}));
vi.mock('@/app/capture/[code]/CaptureChatPanel', () => ({
  CaptureChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-panel" />,
}));
vi.mock('@/app/capture/[code]/SnapshotHistoryPanel', () => ({
  SnapshotHistoryPanel: () => <div data-testid="snapshot-panel" />,
}));
vi.mock('@/app/capture/[code]/IngestionCheckIn', () => ({
  IngestionCheckIn: () => <div data-testid="ingestion-checkin" />,
}));
vi.mock('@/app/capture/[code]/HelpPanel', () => ({
  CaptureHelpPanel: () => <div data-testid="help-panel" />,
}));
vi.mock('@/app/capture/[code]/CanvasImportSummary', () => ({
  CanvasImportSummary: () => <div data-testid="canvas-summary" />,
}));
vi.mock('@/app/capture/[code]/CaptureHero', () => ({
  CaptureHero: () => <div data-testid="capture-hero" />,
}));
vi.mock('@/app/capture/[code]/ReconciliationStepper', () => ({
  ReconciliationStepper: () => <div data-testid="reconcile" />,
}));
vi.mock('@/app/capture/[code]/ProfileReviewPanel', () => ({
  ProfileReviewPanel: () => <div data-testid="review-panel" />,
}));
vi.mock('@/lib/capture/material-display', () => ({
  shouldShowMaterialsStep: ({ stage, landingStep }: { stage: string; landingStep: string }) =>
    stage === 'chat' && landingStep === 'materials',
}));
vi.mock('@/lib/faculty', () => ({
  FACULTY_ROSTER: ['Alice Appleton', 'Department canonical'],
  DEPARTMENT_CANONICAL: 'Department canonical',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Triage is gated by the `triageEnabled` PROP (resolved server-side in page.tsx
// and passed down). It is NOT read from process.env in this client component —
// so tests drive it via the prop, not a module mock. (A module mock here would
// mask the real server→client boundary, which is exactly the bug this guards.)

import { CaptureClient } from '@/app/capture/[code]/CaptureClient';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const course: CourseCatalogView = {
  code: 'GC 3800',
  title: 'Junior Seminar',
  description: '',
  prerequisites: '',
  learningObjectives: [],
  majorProjects: [],
  skillsRequired: [],
  auditMode: 'full',
  canvasCourseName: null,
  canvasImportedAt: null,
  pairedCodes: [],
};

function mat(id: string): CaptureMaterial {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 100,
    pageCount: null,
    extractionStatus: 'ok',
    extractionMethod: null,
    extractedText: 'text',
    ignored: false,
    digest: null,
    digestGeneratedAt: null,
    useDigest: false,
    indexingStatus: 'ready',
    indexedAt: null,
    ferpaRisk: 'low',
    autoSetAside: false,
    setAsideReason: null,
    blobUrl: 'blob://x',
    sourceCode: null,
    tier: 'high',
    rawCleared: false,
    retiredAt: null,
  };
}

const baseProps = {
  course,
  initialMaterials: [mat('m1')],
  slug: 'test-slug',
  existingProfile: null,
  existingReviewerStatus: null,
  existingReviewerNote: null,
  initialMessages: [],
  initialReadiness: null,
  savedConversationAt: null,
  priorSnapshotInfo: null,
  initialInstructor: null,
  catalogSyncedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CaptureClient triage wiring', () => {
  it('flag OFF: Continue from materials step goes directly to interview (no triage step)', () => {
    render(<CaptureClient {...baseProps} triageEnabled={false} />);

    // Materials step is visible initially
    expect(screen.getByTestId('materials-step')).toBeTruthy();
    expect(screen.queryByTestId('triage-step')).toBeNull();

    // Click Continue
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Should jump directly to chat/interview, not triage
    expect(screen.queryByTestId('materials-step')).toBeNull();
    expect(screen.queryByTestId('triage-step')).toBeNull();
    // Chat panel shows instead
    expect(screen.getByTestId('chat-panel')).toBeTruthy();
  });

  it('flag ON: Continue from materials step shows TriageStep', () => {
    render(<CaptureClient {...baseProps} triageEnabled={true} />);

    // Materials step is visible initially
    expect(screen.getByTestId('materials-step')).toBeTruthy();

    // Click Continue
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Triage step should now render
    expect(screen.getByTestId('triage-step')).toBeTruthy();
    // Materials step should be gone
    expect(screen.queryByTestId('materials-step')).toBeNull();
    // Chat panel should not yet be visible
    expect(screen.queryByTestId('chat-panel')).toBeNull();
  });

  it('flag ON: TriageStep onIngested transitions to the interview', async () => {
    render(<CaptureClient {...baseProps} triageEnabled={true} />);

    // Advance to triage step
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByTestId('triage-step')).toBeTruthy();

    // Trigger onIngested from triage step
    fireEvent.click(screen.getByRole('button', { name: /ingested/i }));

    // Should advance to interview / chat
    await waitFor(() => {
      expect(screen.queryByTestId('triage-step')).toBeNull();
      expect(screen.getByTestId('chat-panel')).toBeTruthy();
    });
  });
});
