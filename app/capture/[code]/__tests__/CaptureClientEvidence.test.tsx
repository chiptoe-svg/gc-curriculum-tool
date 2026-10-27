/**
 * Thin-evidence gate before the interview (owner, 2026-10-27: "push back when it
 * has basically nothing to go on" — warn and let them continue). GC 4400 was
 * captured from a syllabus alone with two uploads never read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const fetchCourseMaterials = vi.fn();
vi.mock('@/lib/capture/fetch-course-materials', () => ({
  fetchCourseMaterials: (...a: unknown[]) => fetchCourseMaterials(...a),
}));

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
  materialProvenance: () => 'uploaded',
}));
vi.mock('@/lib/faculty', () => ({
  FACULTY_ROSTER: ['Alice Appleton', 'Department canonical'],
  DEPARTMENT_CANONICAL: 'Department canonical',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));


import { CaptureClient } from '@/app/capture/[code]/CaptureClient';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

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


const syllabus = { ...mat('syl'), fileName: '4400_6400 Syllabus Fall 2026.pdf', isSyllabus: true };
const unread = { ...mat('pb'), fileName: 'Photo Book Assignment.docx', indexingStatus: 'pending' as const, extractionStatus: 'pending', extractedText: null };
const thin = [syllabus, unread];
const healthy = [syllabus, { ...unread, indexingStatus: 'ready' as const, extractionStatus: 'ok', extractedText: 'brief' }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
});

describe('CaptureClient thin-evidence gate', () => {
  it('warns before a new interview and lets them continue anyway', async () => {
    fetchCourseMaterials.mockResolvedValue(thin);
    render(<CaptureClient {...baseProps} initialMaterials={thin} triageEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(screen.getByText(/very little to work from/i)).toBeTruthy());
    expect(screen.getByText(/Photo Book Assignment\.docx/)).toBeTruthy();
    expect(screen.queryByTestId('chat-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }));
    expect(screen.getByTestId('chat-panel')).toBeTruthy();
  });

  it('offers a way back to materials', async () => {
    fetchCourseMaterials.mockResolvedValue(thin);
    render(<CaptureClient {...baseProps} initialMaterials={thin} triageEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await waitFor(() => screen.getByText(/very little to work from/i));

    fireEvent.click(screen.getByRole('button', { name: /back to materials/i }));
    expect(screen.getByTestId('materials-step')).toBeTruthy();
  });

  it('uses the fresh material list: files read by Ingest do not trigger the warning', async () => {
    fetchCourseMaterials.mockResolvedValue(healthy);
    render(<CaptureClient {...baseProps} initialMaterials={thin} triageEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(screen.getByTestId('chat-panel')).toBeTruthy());
    expect(screen.queryByText(/very little to work from/i)).toBeNull();
  });

  it('a resumed interview shows the warning without stopping the chat', async () => {
    fetchCourseMaterials.mockResolvedValue(thin);
    const initialMessages = [{ role: 'assistant' as const, content: 'hello' }];
    render(<CaptureClient {...baseProps} initialMaterials={thin} initialMessages={initialMessages as never} triageEnabled={false} />);

    await waitFor(() => expect(screen.getByText(/very little to work from/i)).toBeTruthy());
    expect(screen.getByTestId('chat-panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /continue anyway/i })).toBeNull();
  });
});
