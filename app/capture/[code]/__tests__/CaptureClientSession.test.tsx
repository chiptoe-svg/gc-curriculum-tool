import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({
  CaptureMaterialsStep: () => <div data-testid="materials-step" />,
}));
vi.mock('@/app/capture/[code]/TriageStep', () => ({
  TriageStep: () => <div data-testid="triage-step" />,
}));
vi.mock('@/app/capture/[code]/CaptureChatPanel', () => ({
  CaptureChatPanel: ({ sessionId, onSessionIdChange }: { sessionId: string | null; onSessionIdChange: (s: string) => void }) => (
    <div data-testid="chat-panel">
      session=[{sessionId ?? ''}]
      <button onClick={() => onSessionIdChange('S2')}>start-session</button>
    </div>
  ),
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
vi.mock('@/lib/faculty', () => ({
  FACULTY_ROSTER: ['Alice Appleton', 'Department canonical'],
  DEPARTMENT_CANONICAL: 'Department canonical',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CaptureClient } from '@/app/capture/[code]/CaptureClient';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

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

// Non-empty initialMessages puts CaptureClient straight into the chat stage
// (landingStep defaults to 'interview'), which renders the Reset interview
// button without needing to click through materials/triage first.
const baseProps = {
  course,
  initialMaterials: [mat('m1')],
  slug: 'test-slug',
  existingProfile: null,
  existingReviewerStatus: null,
  existingReviewerNote: null,
  initialMessages: [{ role: 'user', content: 'hi' }] as ChatMessage[],
  initialReadiness: null,
  savedConversationAt: null,
  priorSnapshotInfo: null,
  initialInstructor: null,
  catalogSyncedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The page owns the interview's server session (owner, 2026-10-28): a reload
 *  resumes it, Back to chat keeps it, and Reset drops it so the next opening
 *  turn starts a new session (the agent refuses an opening turn on a session
 *  that already has messages). */
describe('CaptureClient — interview session', () => {
  it('resumes the session the page was loaded with', () => {
    render(<CaptureClient {...baseProps} initialSessionId="S1" />);
    expect(screen.getByTestId('chat-panel').textContent).toContain('session=[S1]');
  });

  it('keeps a session the panel started', () => {
    render(<CaptureClient {...baseProps} initialSessionId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'start-session' }));
    expect(screen.getByTestId('chat-panel').textContent).toContain('session=[S2]');
  });

  it('Reset drops the session', async () => {
    render(<CaptureClient {...baseProps} initialSessionId="S1" />);
    fireEvent.click(screen.getByRole('button', { name: /reset interview/i }));
    await waitFor(() => expect(screen.getByTestId('chat-panel').textContent).toContain('session=[]'));
  });
});
