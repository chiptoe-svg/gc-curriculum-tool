/**
 * Follow-up (2026-10-06): no K/U/D codes left anywhere in the review UI —
 * rolled-up rows, the rationale under "Needs adjusting", the raised-score
 * prompt, the validation banner, margin notes, triage reasons, and the
 * reconciliation step's lists.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile, type CaptureCompetency } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel, triageCompetency } from '@/app/capture/[code]/ProfileReviewPanel';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';
import { ReconciliationStepper } from '@/app/capture/[code]/ReconciliationStepper';

const CODE = /\b[KUD]\s*(=\s*)?[0-5]\b|K\/U\/D|\b[KUD] ≥/;
const cite = [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }];

function comp(over: Partial<CaptureCompetency> = {}): CaptureCompetency {
  return {
    statement: 'Builds a LinkedIn profile', type: 'technical', k_depth: 3, u_depth: 1, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd',
    rationale: 'K=3 because students recall the parts. U=1 because it is not feedbacked. D=2 because they follow a tutorial.',
    source: 'materials', citations: cite, k_says: null, u_says: null, d_says: null,
    ...over,
  } as unknown as CaptureCompetency;
}

function profile(c: CaptureCompetency[], over: Record<string, unknown> = {}): CaptureProfile {
  return {
    competencies: c, incoming_expectations: [],
    verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'inferred', citations: [] },
    audit_notes: { prereq_gaps: ['Assumes K2 color theory from GC 1040'], objective_misalignments: ['Objective 2 claims D4 but only D=1 is evidenced'], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], course_code: 'GC 3800', scale_version: captureScaleVersion, generated_at: 'now',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
    ...over,
  } as unknown as CaptureProfile;
}

function renderPanel(p: CaptureProfile) {
  return render(
    <ProfileReviewPanel profile={p} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3800" courseTitle="Seminar" slug="s"
      onSnapshotCreated={() => {}} />,
  );
}

describe('rolled-up one-line rows', () => {
  it('show a compact plain form, with the full sentence on hover', () => {
    renderPanel(profile([comp()]));
    const row = screen.getByRole('button', { name: /Builds a LinkedIn profile/ });
    expect(row.textContent).not.toMatch(CODE);
    const depth = within(row).getByTestId('row-depth');
    expect(depth.textContent).toBe('Knowing: recalls · Reasoning: restates · Doing: with a reference');
    expect(depth.getAttribute('title')).toBe(
      'recalls it without prompting and can restate the explanation; does it with a reference or checklist',
    );
  });
  it('a foundational row shows only Doing', () => {
    renderPanel(profile([comp({ type: 'foundational', k_depth: null, u_depth: null, d_depth: 1, statement: 'Agency' })]));
    expect(within(screen.getByRole('button', { name: /Agency/ })).getByTestId('row-depth').textContent).toBe('Doing: with direction');
  });
});

describe('rationale under "Needs adjusting"', () => {
  it('rewrites K=3 / U=1 / D=2 into labeled words', () => {
    render(<CompetencyPortrait competency={comp()} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
    const r = screen.getByTestId('rationale');
    expect(r.textContent).toBe(
      'Knowing (recalls it without prompting) because students recall the parts. Reasoning (can restate the explanation) because it is not feedbacked. Doing (does it with a reference or checklist) because they follow a tutorial.',
    );
  });
});

describe('other review text', () => {
  it('margin notes are rewritten', () => {
    renderPanel(profile([comp()]));
    fireEvent.click(screen.getAllByRole('button', { name: /expand/i })[0]!);
    expect(screen.getByText(/Assumes recognizes it color theory from GC 1040/)).toBeInTheDocument();
    expect(screen.getByText(/Objective 2 claims adapts it to new conditions but only Doing \(does it with step-by-step direction\) is evidenced/)).toBeInTheDocument();
  });

  it('the raised-score prompt names the change in words', () => {
    renderPanel(profile([comp()]));
    fireEvent.click(screen.getByRole('button', { name: /Builds a LinkedIn profile/ }));
    fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
    const row = screen.getByTestId('flag-row-d');
    fireEvent.click(within(row).getByRole('button', { name: /change/i }));
    fireEvent.click(within(row).getByRole('radio', { name: /does it independently in familiar situations/ }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'capstone press check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const prompt = screen.getByText(/You raised a score/);
    expect(prompt.textContent).toMatch(/Doing: does it with a reference or checklist → does it independently in familiar situations/);
    expect(prompt.textContent).not.toMatch(CODE);
  });

  it('the validation banner explains the cause without codes', () => {
    renderPanel(profile([comp({ evidence_d: null })]));
    const banner = screen.getByText(/Profile has a validation issue/).closest('div')!;
    expect(banner.textContent).not.toMatch(CODE);
    expect(banner.textContent).toMatch(/needs a supporting excerpt/);
    // the schema's own message ("d_depth > 0 requires an evidence_d excerpt") is translated too
    expect(banner.textContent).not.toMatch(/_depth|evidence_[kud]/);
    expect(banner.textContent).toMatch(/Doing evidence: a Doing level above zero needs a supporting excerpt/);
  });

  it('triage reasons use Reasoning / Doing, not Understand / Do', () => {
    const theory = triageCompetency({ statement: 's', u_depth: 3, d_depth: 1, source: 'materials', citations: cite as never }, []);
    expect(theory.reason).toBe('Theory without craft — strong reasoning, little hands-on doing.');
    const craft = triageCompetency({ statement: 's', u_depth: 1, d_depth: 3, source: 'materials', citations: cite as never }, []);
    expect(craft.reason).toBe('Craft without articulation — strong doing, little reasoning about why.');
  });
});

describe('reconciliation step lists', () => {
  const p = profile([comp()], {
    incoming_expectations: [{ statement: 'Basic color theory', expected_depth: { k: 2, u: 1, d: 0 }, source: 'inferred', citations: [] }],
  });

  it('show plain compact levels, plain proposal rationale, and word labels on the score inputs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ proposals: [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 1 }, rationale: 'D2 is generous; D=1 fits' }] }) }));
    const { container } = render(<ReconciliationStepper profile={p} slug="s" courseCode="GC 3800" onComplete={() => {}} />);
    // advance to the incoming step (the outgoing step was retired 2026-06-15)
    fireEvent.click(screen.getByRole('button', { name: /proceed/i }));
    expect(screen.getByText('Knowing: recognizes · Reasoning: restates · Doing: not yet')).toBeInTheDocument();
    // a proposal: rationale + edit inputs in words
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lower it' } });
    fireEvent.click(screen.getByRole('button', { name: /make suggested change/i }));
    expect(await screen.findByText(/does it with a reference or checklist is generous; Doing \(does it with step-by-step direction\) fits/)).toBeInTheDocument();
    expect(screen.getByLabelText('Doing level')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(CODE);
    vi.unstubAllGlobals();
  });
});
