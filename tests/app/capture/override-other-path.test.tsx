/**
 * A raise that arrives WITHOUT the Change flow's evidence (any other path —
 * here a stand-in portrait that just raises Doing) still needs the
 * approval-time reason.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { validProfile } from './fixtures/override-profile';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));
vi.mock('@/app/capture/[code]/CompetencyPortrait', () => ({
  CompetencyPortrait: ({ competency, onChange }: { competency: CaptureCompetency; onChange: (c: CaptureCompetency) => void }) => (
    <button type="button" onClick={() => onChange({ ...competency, d_depth: competency.d_depth + 1, evidence_d: 'x' })}>
      raise without evidence box
    </button>
  ),
}));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

it('a raise from another path still asks "why?" and blocks approval until answered', () => {
  render(
    <ProfileReviewPanel profile={validProfile()} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 2400" courseTitle="Color" slug="s" onSnapshotCreated={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /raise without evidence box/ }));
  const prompt = screen.getByText(/You raised a score/i);
  // named in words, no score codes
  expect(prompt.textContent).toMatch(/Doing: does it with a reference or checklist → does it independently in familiar situations/);
  expect(prompt.textContent).not.toMatch(/\b[KUD]\s*=?\s*[0-5]\b/);
  expect(screen.getByText('1 raised score need a reason before “Approve the profile”.')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/Reason for the higher level/i), { target: { value: 'press check' } });
  expect(screen.queryByText(/raised score.*need a reason/i)).toBeNull();
});
