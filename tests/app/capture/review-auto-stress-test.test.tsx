/**
 * Review flow (2026-10-06): the stress test runs automatically after a
 * profile is generated; its flags become the "Worth a look" cards; the
 * approve guard shows a live count; "Save edits" is renamed to what it does.
 */
import React from 'react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile, type CaptureCompetency } from '@/lib/ai/capture/schema';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import type { StressTestState } from '@/app/capture/[code]/useStressTest';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({ StressTestPanel: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

const cite = [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }];
function comp(statement: string, over: Partial<CaptureCompetency> = {}): CaptureCompetency {
  return {
    statement, type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
    source: 'materials', citations: cite, k_says: null, u_says: null, d_says: null,
    ...over,
  } as unknown as CaptureCompetency;
}

// #0 and #2 are heuristically flagged (AI-inferred); #1 is confident.
function profile(): CaptureProfile {
  return {
    competencies: [
      comp('Inferred budget skill', { source: 'inferred', citations: [] }),
      comp('Confident layout skill'),
      comp('Inferred fair skill', { source: 'inferred', citations: [] }),
    ],
    incoming_expectations: [],
    // Schema-valid, so validation never disables Save/Approve in these tests.
    verification_summary: {
      course_shape: 'Seminar.', strongest_evidence: ['Budget'], dimensional_patterns: [],
      catalog_vs_evidence: [], foundationals_glance: 'Agency.', source: 'inferred', citations: [],
    },
    scale_version: captureScaleVersion, generated_at: '2026-10-06T00:00:00Z',
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], course_code: 'GC 3800',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

const RESULT: StressTestResultType = {
  per_competency: [
    { competency_index: 0, confidence: 'high', concerns: [], suggested_adjustments: null },
    { competency_index: 1, confidence: 'disputed', concerns: ['D2 rests on a single layout exercise.'], suggested_adjustments: null },
    { competency_index: 2, confidence: 'high', concerns: [], suggested_adjustments: null },
  ],
  profile_level: { catalog_vs_evidence_concerns: [], consistency_concerns: [], coverage_concerns: [] },
  overall_assessment: 'mixed',
  summary: 'Mostly sound.',
};

function st(over: Partial<StressTestState>): StressTestState {
  return { status: 'idle', result: null, error: null, telemetry: null, run: vi.fn(), ...over };
}

function renderPanel(stressTest?: StressTestState, onSave = vi.fn(async () => {})) {
  const ui = (s?: StressTestState) => (
    <ProfileReviewPanel
      profile={profile()}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={onSave}
      onResumeChat={() => {}}
      courseCode="GC 3800"
      courseTitle="Junior Seminar"
      slug="s"
      onSnapshotCreated={() => {}}
      stressTest={s}
    />
  );
  const r = render(ui(stressTest));
  return { ...r, rerenderWith: (s: StressTestState) => r.rerender(ui(s)) };
}

it('fixture is schema-valid', async () => {
  const { captureProfileSchema } = await import('@/lib/ai/capture/schema');
  const r = captureProfileSchema.safeParse(profile());
  expect(r.success ? null : r.error.issues[0]).toBeNull();
});

const approveBtn = () => screen.getByRole('button', { name: /approve the profile/i }) as HTMLButtonElement;

describe('automatic stress test in the review panel', () => {
  it('there is no manual "Stress-test this profile" button', () => {
    renderPanel(st({}));
    expect(screen.queryByRole('button', { name: /stress-test this profile/i })).toBeNull();
  });

  it('shows a small "Checking the profile…" state while it runs, without blocking the cards', () => {
    renderPanel(st({ status: 'running' }));
    expect(screen.getByRole('status').textContent).toMatch(/Checking the profile…/);
    expect(screen.getAllByRole('button', { name: /looks right/i })).toHaveLength(2);
  });

  it('when it finishes, its flags become the "Worth a look" cards, each with its plain reason', () => {
    const { rerenderWith } = renderPanel(st({ status: 'running' }));
    rerenderWith(st({ status: 'done', result: RESULT }));
    // Only the stress-flagged card (#1) is now worth a look.
    const buttons = screen.getAllByRole('button', { name: /looks right/i });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText(/does it with a reference or checklist rests on a single layout exercise\./)).toBeInTheDocument();
    expect(screen.queryByText(/The AI inferred this/)).toBeNull();
    expect(screen.getByText('1 card left to review — confirm or adjust each to unlock “Approve the profile”')).toBeInTheDocument();
  });

  it('a card already confirmed before the result arrives stays put (confirmed)', () => {
    const { rerenderWith } = renderPanel(st({ status: 'running' }));
    fireEvent.click(screen.getAllByRole('button', { name: /looks right/i })[0]!);
    rerenderWith(st({ status: 'done', result: RESULT }));
    expect(screen.getByRole('button', { name: /✓ Confirmed/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /looks right/i })).toHaveLength(1);
  });

  it('if the check fails, the review keeps the existing flags and says so', () => {
    renderPanel(st({ status: 'error', error: 'daily cost cap reached' }));
    expect(screen.getByRole('status').textContent).toMatch(/automatic check didn.t finish/i);
    expect(screen.getAllByText(/The AI inferred this/)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /looks right/i })).toHaveLength(2);
  });

  it('a quiet "Re-check" link reruns it', () => {
    const run = vi.fn();
    renderPanel(st({ status: 'done', result: RESULT, run }));
    fireEvent.click(screen.getByRole('button', { name: /re-check/i }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('approve count line', () => {
  it('shows "N cards left to review", counts down live, and enables Approve at zero', async () => {
    renderPanel(st({}));
    expect(screen.getByText('2 cards left to review — confirm or adjust each to unlock “Approve the profile”')).toBeInTheDocument();
    expect(screen.queryByText(/hover for what counts/i)).toBeNull();
    expect(approveBtn().disabled).toBe(true);

    const [first, second] = screen.getAllByRole('button', { name: /looks right/i });
    await act(async () => { fireEvent.click(first!); });
    expect(screen.getByText('1 card left to review — confirm or adjust each to unlock “Approve the profile”')).toBeInTheDocument();
    expect(approveBtn().disabled).toBe(true);

    await act(async () => { fireEvent.click(second!); });
    expect(screen.queryByText(/left to review/)).toBeNull();
    expect(approveBtn().disabled).toBe(false);
  });
});

describe('"Save draft" (was "Save edits")', () => {
  it('is labeled for what it does and saves the draft without approving', async () => {
    const onSave = vi.fn(async () => {});
    renderPanel(st({}), onSave);
    expect(screen.queryByRole('button', { name: /save edits/i })).toBeNull();
    const bar = screen.getByTestId('action-bar');
    const save = within(bar).getByRole('button', { name: /^save draft$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing to save yet

    // Edit a statement → dirty → Save draft enabled; it persists as 'edited', never 'confirmed'.
    const box = screen.getAllByRole('textbox')[0]!;
    fireEvent.change(box, { target: { value: 'Edited statement' } });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0] as unknown[])[1]).toBe('edited');
  });
});
