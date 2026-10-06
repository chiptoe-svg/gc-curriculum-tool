/**
 * CaptureClient wiring for the automatic stress test (2026-10-06): after a
 * profile is GENERATED (and reconciliation persists it), the stress test runs
 * once in the background; simply opening an existing profile never runs it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({ CaptureMaterialsStep: () => null }));
vi.mock('@/app/capture/[code]/TriageStep', () => ({ TriageStep: () => null }));
vi.mock('@/app/capture/[code]/CaptureChatPanel', () => ({
  CaptureChatPanel: ({ onGenerate }: { onGenerate: () => void }) => (
    <button type="button" onClick={onGenerate}>Generate</button>
  ),
}));
vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({ MaterialsPanel: () => null }));
vi.mock('@/app/capture/[code]/SnapshotHistoryPanel', () => ({ SnapshotHistoryPanel: () => null }));
vi.mock('@/app/capture/[code]/IngestionCheckIn', () => ({ IngestionCheckIn: () => null }));
vi.mock('@/app/capture/[code]/HelpPanel', () => ({ CaptureHelpPanel: () => null }));
vi.mock('@/app/capture/[code]/CanvasImportSummary', () => ({ CanvasImportSummary: () => null }));
vi.mock('@/app/capture/[code]/CaptureHero', () => ({ CaptureHero: () => null }));
vi.mock('@/app/capture/[code]/ReconciliationStepper', () => ({
  ReconciliationStepper: ({ profile, onComplete }: { profile: unknown; onComplete: (p: unknown, log: unknown[]) => void }) => (
    <button type="button" onClick={() => onComplete(profile, [])}>Finish reconcile</button>
  ),
}));
vi.mock('@/app/capture/[code]/ProfileReviewPanel', () => ({
  ProfileReviewPanel: ({ stressTest }: { stressTest?: { status: string } }) => (
    <div data-testid="review-panel">stress:{stressTest?.status ?? 'none'}</div>
  ),
}));
vi.mock('@/lib/capture/material-display', () => ({
  shouldShowMaterialsStep: () => false,
  materialProvenance: () => 'uploaded',
}));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['A'], DEPARTMENT_CANONICAL: 'Department canonical' }));
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


const PROFILE = { competencies: [], course_code: 'GC 3800' };
const RESULT = {
  per_competency: [], profile_level: { catalog_vs_evidence_concerns: [], consistency_concerns: [], coverage_concerns: [] },
  overall_assessment: 'sound', summary: 'ok',
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/stress-test')) return { ok: true, status: 200, json: async () => ({ result: RESULT }) };
    if (url.includes('/scores')) return { ok: true, status: 200, json: async () => ({ profile: PROFILE, reviewerStatus: 'ai_drafted' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const stressCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('/stress-test'));

describe('CaptureClient — automatic stress test', () => {
  it('runs once, after generation + reconciliation, and hands the result to the review panel', async () => {
    render(<CaptureClient {...baseProps} initialMessages={[{ role: 'user', content: 'hi' }] as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByRole('button', { name: 'Finish reconcile' });
    expect(stressCalls()).toHaveLength(0); // not before reconciliation is persisted

    fireEvent.click(screen.getByRole('button', { name: 'Finish reconcile' }));
    await waitFor(() => expect(screen.getByTestId('review-panel').textContent).toBe('stress:done'));
    expect(stressCalls()).toHaveLength(1);
    expect(String(stressCalls()[0]![0])).toBe('/api/capture/GC%203800/stress-test?slug=test-slug');
  });

  it('opening an existing profile does not run it', async () => {
    render(<CaptureClient {...baseProps} existingProfile={PROFILE as never} existingReviewerStatus={'ai_drafted' as never} />);
    expect(screen.getByTestId('review-panel').textContent).toBe('stress:idle');
    await new Promise(r => setTimeout(r, 20));
    expect(stressCalls()).toHaveLength(0);
  });
});
