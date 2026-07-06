import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const K_SAYS_TEXT = 'They use the right terms.';

// A competency that lands in the "Worth a look" zone: source 'inferred' with no
// citations triggers triageCompetency's "The AI inferred this" flag.
function makeProfile(): CaptureProfile {
  return {
    competencies: [
      {
        statement: 'Students analyze brand-color reproduction in a capstone technical report',
        type: 'technical' as const,
        k_depth: 4, u_depth: 4, d_depth: 3,
        evidence_k: 'k', evidence_u: 'u', evidence_d: 'd',
        rationale: 'inferred from course arc', source: 'inferred' as const, citations: [],
        k_says: K_SAYS_TEXT,
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

describe('CompetencyCard — portrait rendering', () => {
  it('shows the portrait sentence and renders no range sliders', () => {
    renderPanel();

    // The "Worth a look" competency is already expanded with k_says visible.
    expect(screen.getByText(K_SAYS_TEXT)).toBeInTheDocument();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });
});
