/**
 * Owner, 2026-10-07: the triage step must explain what happens, what the
 * faculty member's job is, and what each level produces — in plain words.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaptureMaterial } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn(async () => null) }));

import { TriageStep } from '@/app/capture/[code]/TriageStep';

const mat = (id: string, fileName: string, tier: 'high' | 'middle' | 'background') =>
  ({
    id, fileName, mimeType: 'application/pdf', sizeBytes: 1024, pageCount: 4,
    extractionStatus: 'pending', extractionMethod: null, extractedText: null, ignored: false,
    digest: null, digestGeneratedAt: null, useDigest: false, indexingStatus: 'pending',
    indexedAt: null, ferpaRisk: 'low', autoSetAside: false, setAsideReason: null,
    blobUrl: '', sourceCode: null, tier, rawCleared: false, retiredAt: null,
  }) as unknown as CaptureMaterial;

function renderStep(materials = [mat('a', 'Syllabus', 'high'), mat('b', 'Reading.pdf', 'background')]) {
  render(<TriageStep courseCode="GC 1010" slug="s" materials={materials} onIngested={() => {}} onBack={() => {}} />);
}

describe('triage step — plain wording', () => {
  it('explains what happens, the faculty job, and why it matters', () => {
    renderStep();
    expect(screen.getByText(/choose how closely to read each file/i)).toBeTruthy();
    expect(screen.getByText(/what happens next/i)).toBeTruthy();
    expect(screen.getByText(/your job/i)).toBeTruthy();
    expect(screen.getByText(/why it matters/i)).toBeTruthy();
    expect(screen.getAllByText(/anything graded/i).length).toBeGreaterThan(0);
  });

  it('names each level by what it does, in sentence case', () => {
    renderStep();
    expect(screen.getByText('High: read in full')).toBeTruthy();
    expect(screen.getByText('Middle: summarized slide by slide')).toBeTruthy();
    expect(screen.getByText('Background: one summary')).toBeTruthy();
    expect(screen.queryByText('HIGH VALUE')).toBeNull();
  });

  it('uses a plain action button and says what comes after', () => {
    renderStep();
    expect(screen.getByRole('button', { name: /read files & continue/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ingest/i })).toBeNull();
    expect(screen.getByText(/you'll go on to the interview/i)).toBeTruthy();
  });

  it('gives the arrows readable tooltips and drops the dead Add slides link', () => {
    renderStep();
    expect(screen.getAllByTitle('Read this more lightly').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Read this more closely').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^add slides$/i })).toBeNull();
    expect(screen.getByText(/to upload them/i)).toBeTruthy();
  });
});
