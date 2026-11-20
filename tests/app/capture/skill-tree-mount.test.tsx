/**
 * (skill tree mount) The review card's tag row is reduced to ONE plain status tag (with a title
 * tooltip). The type chip, the evidence-band chip and "⚠ unverified" are gone;
 * the dispute flag moves into the "Needs adjusting" view.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({ StressTestPanel: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

vi.mock('@/app/build/shared/SkillTreePanel', () => ({ SkillTreePanel: (p: unknown) => <div data-testid="skill-tree-panel" data-props={JSON.stringify(p)} /> }));

vi.mock('@/components/strings/CourseStrings', () => ({ CourseStrings: (p: unknown) => <div data-testid="course-strings" data-props={JSON.stringify(p)} /> }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

function comp(over: Partial<CaptureCompetency>): CaptureCompetency {
  return {
    statement: 'Builds a production budget',
    type: 'technical',
    k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd',
    rationale: 'r', source: 'inferred', citations: [],
    k_says: null, u_says: null, d_says: null,
    ...over,
  } as unknown as CaptureCompetency;
}

function renderWith(c: CaptureCompetency[]) {
  const profile = {
    competencies: c,
    incoming_expectations: [],
    verification_summary: null,
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [],
    course_code: 'GC 3800',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
  return render(
    <ProfileReviewPanel
      profile={profile}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={async () => {}}
      onResumeChat={() => {}}
      courseCode="GC 3800"
      courseTitle="Junior Seminar"
      slug="s"
      onSnapshotCreated={() => {}}
    />,
  );
}

describe('profile review — skill tree placement', () => {
  it('profile review shows the tree placement for the course', () => {
    renderWith([comp({})]);
    expect(screen.getByText('Place skills in the department tree')).toBeTruthy();
    const props = JSON.parse(screen.getByTestId('skill-tree-panel').getAttribute('data-props')!);
    expect(props).toMatchObject({ courseCode: 'GC 3800', mode: 'capture' });
  });

  it('renders the course strings in the review step with the slug query', () => {
    renderWith([comp({})]);
    const props = JSON.parse(screen.getByTestId('course-strings').getAttribute('data-props')!);
    expect(props).toMatchObject({ courseCode: 'GC 3800', mode: 'capture', query: '?slug=s' });
  });

  it('is not shown when the profile has no competencies', () => {
    renderWith([]);
    expect(screen.queryByTestId('course-strings')).toBeNull();
    expect(screen.queryByTestId('skill-tree-panel')).toBeNull();
  });
});
