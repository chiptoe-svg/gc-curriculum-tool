import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';

const comp: CaptureCompetency = {
  statement: 'Analyze packaging requirements',
  type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz item 4', evidence_u: 'design memo', evidence_d: 'die-line project',
  rationale: 'Rubric grades the die-line project independently.',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
};

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
}

describe('CompetencyPortrait — compact state', () => {
  it('shows the portrait sentence, a muted rating, and exactly two actions', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/They use the right terms\./)).toBeInTheDocument();
    expect(screen.getByText(/K4 · U2 · D3/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(b => b.textContent?.trim())).toEqual(['✓ Looks right', 'Needs adjusting']);
    // No evidence, rationale or per-dimension rows until asked for.
    expect(screen.queryByText('design memo')).toBeNull();
    expect(screen.queryByText(/Rubric grades the die-line/)).toBeNull();
    expect(screen.queryByTestId('flag-row-u')).toBeNull();
    expect(screen.queryByText(/^(Evidence|Rationale)$/)).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('"Looks right" confirms; the confirmed state reads "✓ Confirmed"', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /looks right/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    rerender(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={onConfirm} confirmed />);
    expect(screen.getByRole('button', { name: /✓ Confirmed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull();
  });

  it('without onConfirm (a confident row) only "Needs adjusting" is offered', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull();
    expect(screen.getByRole('button', { name: /needs adjusting/i })).toBeInTheDocument();
  });
});

describe('CompetencyPortrait — Needs adjusting', () => {
  it('expands into readable rows: score in words, evidence under it, rationale below; collapses again', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} onConfirm={() => {}} />);
    expand();
    const u = screen.getByTestId('flag-row-u');
    expect(within(u).getByText('Reasoning: 2. Explains the rationale in own words')).toBeInTheDocument();
    expect(within(u).getByText('design memo')).toBeInTheDocument();
    expect(within(screen.getByTestId('flag-row-k')).getByText(/Naming: 4\. Use correct terminology/)).toBeInTheDocument();
    expect(within(screen.getByTestId('flag-row-d')).getByText('die-line project')).toBeInTheDocument();
    expect(screen.getByText('Rubric grades the die-line project independently.')).toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^collapse$/i }));
    expect(screen.queryByTestId('flag-row-u')).toBeNull();
  });

  it('"Lower" lists the lower anchors as full sentences and applies one without confirming', () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} onConfirm={onConfirm} />);
    expand();
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: 'Lower: pick a better description' }));
    fireEvent.click(within(row).getByRole('button', { name: /Restates the explanation as given/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 1 }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Higher" explains that it needs evidence and is gated on it; writes evidence_u; does not confirm', () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} onConfirm={onConfirm} />);
    expand();
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: 'Higher: tell us what shows it' }));
    expect(within(row).getByText(/higher score needs evidence of what students actually do/i)).toBeInTheDocument();
    const commit = within(row).getByRole('button', { name: /raise reasoning/i });
    expect(commit).toBeDisabled();
    fireEvent.change(within(row).getByRole('textbox', { name: /evidence/i }), { target: { value: 'unit-3 exam Q7, class mean 82%' } });
    expect(commit).toBeEnabled();
    fireEvent.click(commit);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 3, evidence_u: 'unit-3 exam Q7, class mean 82%' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders Do-only rows for a foundational competency', () => {
    const f: CaptureCompetency = { ...comp, type: 'foundational', k_depth: null, u_depth: null, k_says: null, u_says: null, d_says: 'Consistently attends to detail.' };
    render(<CompetencyPortrait competency={f} onChange={() => {}} />);
    expand();
    expect(screen.getByTestId('flag-row-d')).toBeInTheDocument();
    expect(screen.queryByTestId('flag-row-k')).toBeNull();
    expect(screen.queryByTestId('flag-row-u')).toBeNull();
  });

  it('hides "Higher" for a dimension already at depth 5 (ceiling)', () => {
    render(<CompetencyPortrait competency={{ ...comp, d_depth: 5 }} onChange={() => {}} />);
    expand();
    const row = screen.getByTestId('flag-row-d');
    expect(within(row).queryByRole('button', { name: /^higher/i })).toBeNull();
    expect(within(row).getByRole('button', { name: /^lower/i })).toBeInTheDocument();
  });

  it('hides "Lower" for a dimension at depth 0 (floor)', () => {
    render(<CompetencyPortrait competency={{ ...comp, d_depth: 0 }} onChange={() => {}} />);
    expand();
    const row = screen.getByTestId('flag-row-d');
    expect(within(row).queryByRole('button', { name: /^lower/i })).toBeNull();
    expect(within(row).getByRole('button', { name: /^higher/i })).toBeInTheDocument();
  });
});
