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

const STMT = 'Students set up an ink film on press';
const competency = (d: number) => ({
  statement: STMT, type: 'technical' as const, k_depth: 2, u_depth: 2, d_depth: d,
  evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r', source: 'both' as const,
  citations: [{ type: 'chunk' as const, chunkId: 'c1', excerpt: 'press lab rubric' }],
  k_says: null, u_says: null, d_says: null,
});

// Recheck draft: the re-score raised Doing 2 → 3 and waits for a decision.
function makeProfile(mode: 'recheck' | 'targeted' = 'recheck'): CaptureProfile {
  const targeted = mode === 'targeted';
  return {
    competencies: [competency(targeted ? 2 : 3)],
    incoming_expectations: [],
    verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'materials' as const, citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred' as const, citations: [] },
    course_emphasis: [], generated_at: new Date().toISOString(), scale_version: 'v1', course_code: 'GC 3460',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
    revision: {
      mode, baseline_snapshot_id: 'snap-1', stale_evidence: [], changed_sections: [],
      changes: [{ statement: STMT, kind: 'moved', label: 'no_new_evidence', dims: [{ dim: 'd', from: 2, to: 3 }], new_citations: [], before: competency(2), after: competency(3), decision: targeted ? 'undone' : 'pending' }],
    },
  } as unknown as CaptureProfile;
}

function renderPanel(mode: 'recheck' | 'targeted' = 'recheck') {
  return render(
    <ProfileReviewPanel
      profile={makeProfile(mode)} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3460" courseTitle="Flexo" slug="s"
      onSnapshotCreated={() => {}}
    />,
  );
}

const approveButtons = () => screen.getAllByRole('button', { name: /approve the profile/i }) as HTMLButtonElement[];

describe('ProfileReviewPanel — revision change list', () => {
  it('approve is disabled while a change is pending', () => {
    renderPanel();
    expect(screen.getByTestId('revision-changes')).toBeTruthy();
    expect(approveButtons().every(b => b.disabled)).toBe(true);
    expect(screen.getAllByText('Decide on each change above first.').length).toBeGreaterThan(0);
  });

  it('keeping a re-scored raise unlocks approval without asking for a reason', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Keep change' }));
    expect(screen.queryByText('Decide on each change above first.')).toBeNull();
    expect(screen.queryByText(/need a reason/i)).toBeNull();
    expect(approveButtons().some(b => !b.disabled)).toBe(true);
  });

  it('targeted: keeping a change that was set back is not treated as a faculty raise', () => {
    renderPanel('targeted');
    fireEvent.click(screen.getByRole('button', { name: 'Keep change' }));
    expect(screen.queryByText(/need a reason/i)).toBeNull();
  });

  it('undoing an added competency keeps "Worth a look" on the same flagged row', () => {
    const flagged = {
      statement: 'Students analyze brand-color reproduction', type: 'technical' as const, k_depth: 4, u_depth: 4, d_depth: 3,
      evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'inferred', source: 'inferred' as const, citations: [],
      k_says: null, u_says: null, d_says: null,
    };
    const added = competency(3);
    const p = makeProfile();
    const profile = {
      ...p,
      competencies: [added, flagged],
      revision: { ...p.revision!, changes: [{ statement: STMT, kind: 'added', label: 'new_evidence', dims: [{ dim: 'd', from: null, to: 3 }], new_citations: [], before: null, after: added, decision: 'pending' }] },
    } as unknown as CaptureProfile;
    render(
      <ProfileReviewPanel profile={profile} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
        onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3460" courseTitle="Flexo" slug="s" onSnapshotCreated={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: /looks right/i })).toBeTruthy();
  });
});
