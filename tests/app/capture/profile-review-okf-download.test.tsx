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

function makeProfile(): CaptureProfile {
  const comp = (statement: string) => ({
    statement, type: 'technical' as const,
    k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k evidence', evidence_u: 'u evidence', evidence_d: 'd evidence',
    rationale: 'rationale', source: 'materials' as const,
    citations: [{ type: 'chunk' as const, chunkId: 'c1', messageId: null, excerpt: 'ex' }],
  });
  return {
    competencies: [comp('Color management')],
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

function renderPanel(hasSnapshot?: boolean) {
  return render(
    <ProfileReviewPanel
      profile={makeProfile()}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={async () => {}}
      onResumeChat={() => {}}
      courseCode="GC 3800"
      courseTitle="Junior Seminar"
      slug="test-slug"
      onSnapshotCreated={() => {}}
      hasSnapshot={hasSnapshot}
    />,
  );
}

describe('ProfileReviewPanel — OKF download link', () => {
  it('shows a "↓ Markdown" download link to the OKF route when a snapshot exists', () => {
    renderPanel(true);
    const links = screen.getAllByRole('link', { name: /markdown/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('http://130.127.162.180:3000/view/GC%203800/okf');
      expect(link.getAttribute('download')).not.toBeNull();
    }
    const bundle = screen.getByRole('link', { name: /Bundle/ });
    expect(bundle).toHaveAttribute('href', expect.stringContaining('/okf-bundle'));
  });

  it('hides the download link when no snapshot exists', () => {
    renderPanel(false);
    expect(screen.queryByRole('link', { name: /markdown/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Bundle/ })).toBeNull();
  });
});
