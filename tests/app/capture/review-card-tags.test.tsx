/**
 * The review card's tag row is reduced to ONE plain status tag (with a title
 * tooltip). The type chip, the evidence-band chip and "⚠ unverified" are gone;
 * the dispute flag moves into the "Needs adjusting" view.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureProfile, CaptureCompetency } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({ StressTestPanel: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

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

function renderWith(c: CaptureCompetency) {
  const profile = {
    competencies: [c],
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

describe('review card — one plain status tag', () => {
  it('an AI-inferred card shows one tag, "AI\'s inference", with a tooltip', () => {
    renderWith(comp({ source: 'inferred' }));
    const tags = screen.getAllByTestId('status-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toBe("AI's inference");
    expect(tags[0]!.getAttribute('title')).toMatch(/no assignment, rubric, or interview answer/i);
  });

  it('drops the type chip, the evidence-band chip and "⚠ unverified"', () => {
    renderWith(comp({ source: 'instructor', d_depth: 3 }));
    expect(screen.queryByText(/^technical$/i)).toBeNull();
    expect(screen.queryByText(/^claim$/i)).toBeNull();
    expect(screen.queryByText(/unverified/i)).toBeNull();
  });

  it('a high score resting on the interview alone reads "Needs evidence"', () => {
    renderWith(comp({ source: 'instructor', d_depth: 3 }));
    const tag = screen.getByTestId('status-tag');
    expect(tag.textContent).toBe('Needs evidence');
    expect(tag.getAttribute('title')).toMatch(/interview answers alone/i);
  });

  it('a card citing course materials reads "From course materials"', () => {
    renderWith(comp({
      source: 'materials',
      citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'Budget rubric' }] as never,
    }));
    // Rolled-up confident row → open it to see the card.
    fireEvent.click(screen.getByRole('button', { name: /Builds a production budget/ }));
    expect(screen.getByTestId('status-tag').textContent).toBe('From course materials');
  });

  it('the dispute flag lives inside "Needs adjusting", not in the tag row', () => {
    renderWith(comp({ source: 'inferred' }));
    expect(screen.queryByRole('button', { name: /flag/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
    expect(screen.getByRole('button', { name: /flag this reading/i })).toBeInTheDocument();
  });
});
