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

const FLAGGED_STATEMENT = 'Students analyze brand-color reproduction in a capstone technical report';

// A competency that lands in the "Worth a look" zone: source 'inferred' with no
// citations triggers triageCompetency's "The AI inferred this" flag.
function makeProfile(): CaptureProfile {
  return {
    competencies: [
      {
        statement: FLAGGED_STATEMENT, type: 'technical' as const,
        k_depth: 4, u_depth: 4, d_depth: 3,
        evidence_k: 'k', evidence_u: 'u', evidence_d: 'd',
        rationale: 'inferred from course arc', source: 'inferred' as const, citations: [],
        k_says: 'They recall color terminology.',
        u_says: 'They explain why color profiles matter.',
        d_says: 'They produce a calibration report.',
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      overall_shape: 'Balanced', strongest_evidence: 'Rubric', dimensional_patterns: 'Aligned',
      catalog_vs_evidence: 'Consistent', foundationals_at_a_glance: 'Agency present',
      source: 'materials' as const, citations: [],
    },
    audit_notes: {
      prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [],
      suggested_objective_revisions: [], source: 'inferred' as const, citations: [],
    },
    course_emphasis: [], generated_at: new Date().toISOString(), scale_version: 'v2',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

function renderPanel() {
  return render(
    <ProfileReviewPanel
      profile={makeProfile()}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={async () => {}}
      onResumeChat={() => {}}
      courseCode="GC 4400"
      courseTitle="Capstone"
      slug="test-slug"
      onSnapshotCreated={() => {}}
    />,
  );
}

// Helper: open "Needs adjusting" and apply a downward score correction via
// "Lower: pick a better description" → the first offered lower anchor.
function applyPortraitCorrection() {
  fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
  const flagRow = screen.getByTestId('flag-row-d');
  fireEvent.click(within(flagRow).getByRole('button', { name: /^lower/i }));
  fireEvent.click(within(flagRow).getByTestId('lower-opt-d-0'));
}

describe('ProfileReviewPanel — adjusting a portrait score does not auto-confirm', () => {
  it('keeps the "Worth a look" row unconfirmed ("✓ Looks right") after a score correction', () => {
    renderPanel();

    // The flagged row starts unreviewed: button reads "✓ Looks right".
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /✓ Confirmed/i })).toBeNull();

    // Apply a portrait correction on the flagged competency.
    applyPortraitCorrection();

    // The portrait correction must NOT flip the row to confirmed — confirmation is the
    // explicit button click, not a side effect of correcting a score.
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /✓ Confirmed/i })).toBeNull();
  });

  it('marks the row confirmed only when the explicit button is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /looks right/i }));
    expect(screen.getByRole('button', { name: /✓ Confirmed/i })).toBeTruthy();
  });

  it('keeps a flagged row in place (does not migrate to confident) when a score is corrected', () => {
    renderPanel();
    // The flagged row starts expanded with a reason label + confirm button.
    expect(screen.getByText(/resting on your word/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();

    // Apply a portrait correction to change a score.
    applyPortraitCorrection();

    // Membership is frozen at load — the row stays a full, confirmable card and
    // never rolls up into the confident zone. The portrait is still present.
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /needs adjusting/i })).toBeTruthy();
  });
});
