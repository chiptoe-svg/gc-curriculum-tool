import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/capture/[code]/CaptureMaterialsStep', () => ({
  CaptureMaterialsStep: ({ onContinue }: { onContinue: () => void }) => <button onClick={onContinue}>materials-continue</button>,
}));
vi.mock('@/app/capture/[code]/TriageStep', () => ({ TriageStep: () => <div /> }));
vi.mock('@/app/capture/[code]/CaptureChatPanel', () => ({
  CaptureChatPanel: ({ staged, sessionId }: { staged?: boolean; sessionId: string | null }) => (
    <div data-testid="chat-panel">staged=[{String(!!staged)}] session=[{sessionId ?? ''}]</div>
  ),
}));
vi.mock('@/app/capture/[code]/staged/EvidenceMapStep', () => ({
  EvidenceMapStep: ({ onStart }: { onStart: (s: string) => void }) => <button data-testid="map-step" onClick={() => onStart('SX')}>map-step</button>,
}));
vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({ MaterialsPanel: () => <div /> }));
vi.mock('@/app/capture/[code]/SnapshotHistoryPanel', () => ({ SnapshotHistoryPanel: () => <div /> }));
vi.mock('@/app/capture/[code]/IngestionCheckIn', () => ({ IngestionCheckIn: () => <div /> }));
vi.mock('@/app/capture/[code]/HelpPanel', () => ({ CaptureHelpPanel: () => <div /> }));
vi.mock('@/app/capture/[code]/CanvasImportSummary', () => ({ CanvasImportSummary: () => <div /> }));
vi.mock('@/app/capture/[code]/CaptureHero', () => ({ CaptureHero: () => <div /> }));
vi.mock('@/app/capture/[code]/ReconciliationStepper', () => ({ ReconciliationStepper: () => <div /> }));
vi.mock('@/app/capture/[code]/ProfileReviewPanel', () => ({ ProfileReviewPanel: () => <div /> }));
const evidenceMaterial = { id: 'm2', fileName: 'assignment.pdf', mimeType: 'application/pdf', sizeBytes: 100, pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'text', ignored: false, digest: null, digestGeneratedAt: null, useDigest: false, indexingStatus: 'ready', indexedAt: null, ferpaRisk: 'low', autoSetAside: false, setAsideReason: null, blobUrl: 'b', sourceCode: null, tier: 'high', rawCleared: false, retiredAt: null, isSyllabus: false, addedInSession: null, facultyNote: null, ignoredItems: [] };
// Enough evidence (a read, non-syllabus file) so the thin-evidence gate does not stand in front of the interview.
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: async () => [{ ...evidenceMaterial }] }));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Alice'], DEPARTMENT_CANONICAL: 'Alice' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CaptureClient } from '@/app/capture/[code]/CaptureClient';

const course = { code: 'GC 3800', title: 'Seminar', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [], auditMode: 'full' as const, canvasCourseName: null, canvasImportedAt: null, pairedCodes: [] };
const material = { id: 'm1', fileName: 'm1.pdf', mimeType: 'application/pdf', sizeBytes: 100, pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'text '.repeat(500), ignored: false, digest: null, digestGeneratedAt: null, useDigest: false, indexingStatus: 'ready', indexedAt: null, ferpaRisk: 'low', autoSetAside: false, setAsideReason: null, blobUrl: 'b', sourceCode: null, tier: 'high', rawCleared: false, retiredAt: null, isSyllabus: true, addedInSession: null, facultyNote: null, ignoredItems: [] };
const baseProps = {
  course, initialMaterials: [material, evidenceMaterial], slug: 's', existingProfile: null, existingReviewerStatus: null, existingReviewerNote: null,
  initialMessages: [], initialReadiness: null, savedConversationAt: null, priorSnapshotInfo: null, initialInstructor: null, catalogSyncedAt: null,
} as unknown as React.ComponentProps<typeof CaptureClient>;
const KEY = 'gc-staged-session:GC 3800';

const route = (evidence: (url: string) => Response) => vi.fn(async (url: string) =>
  String(url).includes('/evidence-map') ? evidence(String(url)) : new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
const ok = () => new Response(JSON.stringify({ sessionId: 'SX', map: null, status: 'ready' }), { status: 200 });
const notFound = () => new Response(JSON.stringify({ error: 'session not found' }), { status: 404 });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

async function toInterview() {
  fireEvent.click(await screen.findByText('materials-continue'));
}

describe('CaptureClient — staged session resume', () => {
  it('a stored id that the server confirms runs the staged flow even though the page chose classic', async () => {
    localStorage.setItem(KEY, 'SX');
    const f = route(ok);
    vi.stubGlobal('fetch', f);
    render(<CaptureClient {...baseProps} staged={false} />);
    await toInterview();
    expect(await screen.findByTestId('map-step')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).toBeNull();
    expect(f.mock.calls.some(c => String(c[0]).includes('/evidence-map?slug=s&sessionId=SX'))).toBe(true);
  });

  it('a stored id the server rejects (404, e.g. another course) is cleared and the page stays classic', async () => {
    localStorage.setItem(KEY, 'SX');
    vi.stubGlobal('fetch', route(notFound));
    render(<CaptureClient {...baseProps} staged={false} />);
    await toInterview();
    expect(await screen.findByTestId('chat-panel')).toHaveTextContent('staged=[false]');
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(screen.queryByTestId('map-step')).toBeNull();
  });

  it('with nothing stored it follows the page choice, and makes no evidence-map call', async () => {
    const f = route(ok);
    vi.stubGlobal('fetch', f);
    render(<CaptureClient {...baseProps} staged={false} />);
    await toInterview();
    expect(await screen.findByTestId('chat-panel')).toBeInTheDocument();
    expect(f.mock.calls.some(c => String(c[0]).includes('/evidence-map'))).toBe(false);
  });

  it('clears the stored id once the interview has its first interviewer message', async () => {
    localStorage.setItem(KEY, 'SX');
    vi.stubGlobal('fetch', route(ok));
    render(<CaptureClient {...baseProps} staged initialMessages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]} />);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it('classic with nothing stored: the chat panel is there on the first render and "Checking…" never appears', async () => {
    vi.stubGlobal('fetch', route(ok));
    render(<CaptureClient {...baseProps} staged={false} />);
    const toInterviewStep = await screen.findByText('materials-continue');
    const seen: string[] = [];
    const obs = new MutationObserver(recs => { for (const r of recs) r.addedNodes.forEach(n => seen.push(n.textContent ?? '')); });
    obs.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(toInterviewStep);
    for (const r of obs.takeRecords()) r.addedNodes.forEach(n => seen.push(n.textContent ?? ''));
    obs.disconnect();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(seen.join('|')).not.toContain('Checking for an interview');
    expect(screen.queryByText(/Checking for an interview/)).toBeNull();
  });

  it('?interview=classic beats a stored id: classic panel, no GET, the id is cleared', async () => {
    localStorage.setItem(KEY, 'SX');
    const f = route(ok);
    vi.stubGlobal('fetch', f);
    render(<CaptureClient {...baseProps} staged={false} explicitClassic />);
    await toInterview();
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('staged=[false]');
    expect(screen.queryByTestId('map-step')).toBeNull();
    expect(f.mock.calls.some(c => String(c[0]).includes('/evidence-map'))).toBe(false);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });
});
