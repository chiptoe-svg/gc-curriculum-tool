import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({
  VerificationSummary: () => <div data-testid="verification-summary" />,
}));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({
  CourseOverview: () => <div data-testid="course-overview" />,
}));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({
  ClassStructureSection: () => <div data-testid="class-structure" />,
}));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({
  MajorProjectsSection: () => <div data-testid="major-projects" />,
}));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({
  StressTestPanel: React.forwardRef((_props: unknown, _ref: unknown) => null),
}));
vi.mock('@/app/capture/[code]/StressTestBadge', () => ({ StressTestBadge: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

const STMT = 'Students analyze brand-color reproduction';
function makeProfile(): CaptureProfile {
  return {
    course_code: 'GC 2400', scale_version: 'v2', generated_at: new Date().toISOString(), overview: null,
    competencies: [{
      statement: STMT, type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
      evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
      source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'ex' }],
      k_says: 'They name the color spaces.',
      u_says: 'They explain gamut differences.',
      d_says: 'They produce a color-managed PDF.',
    }],
    incoming_expectations: [],
    verification_summary: { overall_shape: 'x', strongest_evidence: 'x', dimensional_patterns: 'x', catalog_vs_evidence: 'x', foundationals_at_a_glance: 'x', source: 'materials', citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}
function renderPanel() {
  render(<ProfileReviewPanel profile={makeProfile()} reviewerStatus="ai_drafted" initialReviewerNote={null}
    telemetry={null} onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 2400" courseTitle="Color" slug="s" onSnapshotCreated={() => {}} />);
}

// The single materials competency is non-flagged → confident/rolled-up. Expand to edit.
function ensureExpanded() {
  const portrait = document.querySelector('[data-testid="flag-row-d"]');
  if (portrait) return; // already expanded
  const row = screen.getByRole('button', { name: new RegExp(STMT, 'i') });
  fireEvent.click(row);
}

// Raise Do depth by 1: Needs adjusting → Change (Doing) → next level → evidence → Save changes.
function raiseDoDepthViaPortrait() {
  ensureExpanded();
  fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
  const flagRow = screen.getByTestId('flag-row-d');
  fireEvent.click(within(flagRow).getByRole('button', { name: /change/i }));
  fireEvent.click(within(flagRow).getAllByRole('radio')[3]!); // fixture d_depth is 2 → 3
  fireEvent.change(screen.getByLabelText(/what shows students reach this/i), { target: { value: 'capstone press checks' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
}

describe('K/U/D override rationale gate', () => {
  it('a raise saved through Change with evidence is not asked "why?" again (evidence is the reason)', () => {
    renderPanel();
    raiseDoDepthViaPortrait();
    expect(screen.queryByText(/You raised a score/i)).toBeNull();
    expect(screen.queryByText(/raised score.*need a reason/i)).toBeNull();
  });
  // A raise from any other path still needs the reason: override-other-path.test.tsx.

  it('no reason field for a downward edit', () => {
    renderPanel();
    ensureExpanded();
    // Lower Do depth: Change → level 0 → Save changes.
    fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
    const flagRow = screen.getByTestId('flag-row-d');
    fireEvent.click(within(flagRow).getByRole('button', { name: /change/i }));
    fireEvent.click(within(flagRow).getAllByRole('radio')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.queryByText(/You raised a score/i)).toBeNull();
  });
});
