import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('ProfileReviewPanel — adjusting a KUD slider does not auto-confirm', () => {
  it('keeps the "Worth a look" row at "Looks right ✓" after a slider change', () => {
    renderPanel();

    // The flagged row starts unreviewed: button reads "Looks right ✓".
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /✓ Confirmed/i })).toBeNull();

    // Adjust the Do slider on the flagged competency.
    const doSlider = screen.getByLabelText(`Do depth for "${FLAGGED_STATEMENT}"`);
    fireEvent.change(doSlider, { target: { value: '4' } });

    // The slider edit must NOT flip the row to confirmed — confirmation is the
    // explicit button click, not a side effect of moving a score.
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /✓ Confirmed/i })).toBeNull();
  });

  it('marks the row confirmed only when the explicit button is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /looks right/i }));
    expect(screen.getByRole('button', { name: /✓ Confirmed/i })).toBeTruthy();
  });
});
