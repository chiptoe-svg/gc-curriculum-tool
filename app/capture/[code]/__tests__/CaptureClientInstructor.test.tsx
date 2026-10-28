import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({
  CaptureMaterialsStep: ({ instructor }: { instructor: string }) => (
    <div data-testid="materials-step">instructor=[{instructor}]</div>
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
  materialProvenance: () => 'uploaded',
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
  triageEnabled: false,
};

/** The instructor box defaults to the name on the viewer's personal link
 *  (owner, 2026-10-28: a new instructor not on the roster had to find
 *  "Add a new name…" before she could continue). */
describe('CaptureClient instructor default', () => {
  it('defaults to the personal link name when no session is in progress', () => {
    render(<CaptureClient {...baseProps} defaultInstructor="Haley Appleby" />);
    expect(screen.getByTestId('materials-step').textContent).toBe('instructor=[Haley Appleby]');
  });
  it('a resumed session keeps its own instructor', () => {
    render(<CaptureClient {...baseProps} initialInstructor="Alice Appleton" defaultInstructor="Haley Appleby" />);
    expect(screen.getByTestId('materials-step').textContent).toBe('instructor=[Alice Appleton]');
  });
  it('stays empty without a personal name (department login)', () => {
    render(<CaptureClient {...baseProps} defaultInstructor={null} />);
    expect(screen.getByTestId('materials-step').textContent).toBe('instructor=[]');
  });
});
