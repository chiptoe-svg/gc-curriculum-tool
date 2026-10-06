/**
 * Opened ("Needs adjusting") card redesign — owner-approved 2026-10-06.
 * One row per scored dimension with a single "Change" button; Change opens a
 * radio list of every level; a higher level needs evidence; Save changes /
 * Cancel at the bottom. An explicit Save counts the card as reviewed (new
 * rule); an unsaved pick never does.
 */
import React from 'react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile, type CaptureCompetency } from '@/lib/ai/capture/schema';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

const comp: CaptureCompetency = {
  statement: 'Analyze packaging requirements', type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz item 4', evidence_u: 'design memo', evidence_d: 'die-line project',
  rationale: 'D=3 because the rubric grades the die-line project independently.',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
} as CaptureCompetency;

const open = () => fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
const change = (dim: 'k' | 'u' | 'd') => fireEvent.click(within(screen.getByTestId(`flag-row-${dim}`)).getByRole('button', { name: /change/i }));
const save = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;

describe('opened card — layout', () => {
  it('hides the two action buttons and shows one instruction line', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={() => {}} />);
    open();
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /needs adjusting/i })).toBeNull();
    expect(screen.getByText("Change any score that's wrong — pick the description that fits best, then save.")).toBeInTheDocument();
  });

  it('one row per dimension: bold label + current level in words, evidence muted, one Change button', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    open();
    const d = screen.getByTestId('flag-row-d');
    expect(within(d).getByTestId('row-heading').textContent).toBe('Doing — now: does it independently in familiar situations');
    expect(within(d).getByText('die-line project')).toBeInTheDocument();
    expect(within(d).getAllByRole('button')).toHaveLength(1);
    expect(within(d).queryByRole('button', { name: /lower|higher/i })).toBeNull();
  });

  it('rationale (in words) sits under the rows, above Save changes / Cancel', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    open();
    const r = screen.getByTestId('rationale');
    expect(r.textContent).toMatch(/^Doing \(does it independently in familiar situations\) because/);
    const rows = screen.getByTestId('flag-row-d');
    expect(rows.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(r.compareDocumentPosition(save()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a foundational card has only the Doing row', () => {
    render(<CompetencyPortrait competency={{ ...comp, type: 'foundational', k_depth: null, u_depth: null }} onChange={() => {}} />);
    open();
    expect(screen.getByTestId('flag-row-d')).toBeInTheDocument();
    expect(screen.queryByTestId('flag-row-k')).toBeNull();
    expect(screen.queryByTestId('flag-row-u')).toBeNull();
  });
});

describe('Change list', () => {
  it('lists every level 0–5 in plain words plus the rubric anchor, current one marked', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    open();
    change('d');
    const radios = within(screen.getByTestId('flag-row-d')).getAllByRole('radio');
    expect(radios).toHaveLength(6);
    const cur = within(screen.getByTestId('flag-row-d')).getByRole('radio', { name: /does it independently in familiar situations/ });
    expect((cur as HTMLInputElement).checked).toBe(true);
    expect(cur.closest('label')!.textContent).toMatch(/\(current\)/);
    expect(cur.closest('label')!.textContent).toMatch(/Performs independently in familiar conditions/);
  });

  it('picking a lower level and saving updates the score and confirms the card', () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} onConfirm={onConfirm} />);
    open();
    expect(save().disabled).toBe(true); // nothing changed yet
    change('d');
    fireEvent.click(screen.getByRole('radio', { name: /does it with a reference or checklist/ }));
    expect(onChange).not.toHaveBeenCalled(); // a pick is pending, not applied
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ d_depth: 2, evidence_d: 'die-line project' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('picking a higher level requires evidence before Save is enabled; saves it as the evidence', () => {
    const onChange = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} onConfirm={() => {}} />);
    open();
    change('u');
    fireEvent.click(screen.getByRole('radio', { name: /reasons through new cases/ }));
    const box = screen.getByLabelText('What shows students reach this? (e.g. a graded assignment)');
    expect(save().disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'unit-3 exam Q7' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 4, evidence_u: 'unit-3 exam Q7' }));
  });

  it('Cancel discards pending picks and returns to the compact card', () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} onConfirm={onConfirm} />);
    open();
    change('d');
    fireEvent.click(screen.getByRole('radio', { name: /does it with step-by-step direction/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /needs adjusting/i })).toBeInTheDocument();
    open();
    expect(save().disabled).toBe(true); // the pick did not survive Cancel
  });

  it('after Save the card shows "✓ Adjusted — …" in plain words instead of the action buttons, with Edit again', () => {
    const { rerender } = render(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={() => {}} />);
    open();
    change('d');
    fireEvent.click(screen.getByRole('radio', { name: /does it with a reference or checklist/ }));
    fireEvent.click(save());
    rerender(<CompetencyPortrait competency={{ ...comp, d_depth: 2 }} onChange={() => {}} onConfirm={() => {}} confirmed />);
    expect(screen.getByTestId('adjusted-summary').textContent).toBe('✓ Adjusted — Doing: independently → with a reference');
    expect(screen.queryByRole('button', { name: /looks right|needs adjusting|confirmed/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /edit again/i }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});

/* ── Panel: explicit Save counts as reviewed; an unsaved pick doesn't ── */

function profile(): CaptureProfile {
  const c = (statement: string) => ({
    ...comp, statement, rationale: 'r', source: 'inferred', citations: [],
  });
  return {
    competencies: [c('First inferred skill'), c('Second inferred skill')],
    incoming_expectations: [],
    verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'inferred', citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], course_code: 'GC 3800', scale_version: captureScaleVersion, generated_at: 'now',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}
function renderPanel() {
  return render(
    <ProfileReviewPanel profile={profile()} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3800" courseTitle="S" slug="s" onSnapshotCreated={() => {}} />,
  );
}
const countLine = (n: number) => `${n} card${n === 1 ? '' : 's'} left to review — confirm or adjust each to unlock “Approve the profile”`;

describe('panel — reviewing by adjusting', () => {
  it('an explicit Save changes counts the card as reviewed and the count line updates', async () => {
    renderPanel();
    expect(screen.getByText(countLine(2))).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /needs adjusting/i })[0]!);
    change('d');
    fireEvent.click(screen.getByRole('radio', { name: /does it with a reference or checklist/ }));
    await act(async () => { fireEvent.click(save()); });
    expect(screen.getByTestId('adjusted-summary')).toBeInTheDocument();
    // dirty → the approve guard opens anyway (unchanged A15 rule), so check the
    // header count chip, which tracks reviewed cards only.
    expect(screen.getByText('1 still to confirm')).toBeInTheDocument();
  });

  it('an adjustment without Save does not count (and changes nothing)', () => {
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: /needs adjusting/i })[0]!);
    change('d');
    fireEvent.click(screen.getByRole('radio', { name: /does it with step-by-step direction/ }));
    expect(screen.getByText('2 still to confirm')).toBeInTheDocument();
    expect(screen.getByText(countLine(2))).toBeInTheDocument();
    expect(screen.queryByTestId('adjusted-summary')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
