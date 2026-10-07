/**
 * CaptureClient "Reset interview" button wiring.
 *
 * Bug fix (2026-10-07): the button used to POST to /api/admin/v2-reset,
 * which lib/auth/authorize.ts classify() treats as the 'admin' kind — a
 * scoped faculty access-link holder (capture capability, scope = their own
 * course) got refused. It now POSTs to the course-scoped
 * /api/capture/[code]/reset route, classified 'course-write' and scoped
 * normally. This test only checks the wiring (fetch target + body); the
 * route's own behavior is covered by
 * app/api/capture/[code]/reset/__tests__/route.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({
  CaptureMaterialsStep: () => <div data-testid="materials-step" />,
}));
vi.mock('@/app/capture/[code]/TriageStep', () => ({
  TriageStep: () => <div data-testid="triage-step" />,
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
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureClient — Reset interview button', () => {
  it('POSTs to the course-scoped /api/capture/[code]/reset route, not /api/admin/v2-reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CaptureClient {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /reset interview/i }));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/reset'))).toBe(true));

    const [url, init] = fetchMock.mock.calls.find(c => String(c[0]).includes('/reset'))!;
    expect(String(url)).toContain('/api/capture/GC%203800/reset');
    expect(String(url)).toContain('slug=test-slug');
    expect(String(url)).not.toContain('/api/admin');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ scope: 'session' });

    vi.unstubAllGlobals();
  });
});
