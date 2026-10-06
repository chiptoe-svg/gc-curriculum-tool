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
    // No score-code corner label: the labeled clauses already say each level in words.
    expect(screen.queryByText(/K4 · U2 · D3/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b[KUD][0-5]\b/);
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

describe('CompetencyPortrait — labeled, punctuated clauses', () => {
  it('labels each AI sentence by dimension', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    const p = screen.getByTestId('portrait');
    expect(p.textContent).toBe('Knowing: They use the right terms. Reasoning: They explain why. Doing: They do it on familiar cases.');
  });

  it('turns the generic fallback (no *_says) into labeled sentences, not a run-on', () => {
    const bare = { ...comp, k_says: null, u_says: null, d_says: null } as unknown as CaptureCompetency;
    render(<CompetencyPortrait competency={bare} onChange={() => {}} />);
    expect(screen.getByTestId('portrait').textContent).toBe(
      'Knowing: uses the correct terms. Reasoning: explains it in their own words. Doing: does it independently in familiar situations.',
    );
  });

  it('adds a period to an AI sentence that lacks one', () => {
    const c = { ...comp, k_says: 'They name the parts', u_says: 'They explain why!', d_says: 'They do it.' } as unknown as CaptureCompetency;
    render(<CompetencyPortrait competency={c} onChange={() => {}} />);
    expect(screen.getByTestId('portrait').textContent).toBe('Knowing: They name the parts. Reasoning: They explain why! Doing: They do it.');
  });

  it('a foundational card shows only the Doing clause', () => {
    const f = { ...comp, type: 'foundational', k_depth: null, u_depth: null, d_says: null, d_depth: 2 } as unknown as CaptureCompetency;
    render(<CompetencyPortrait competency={f} onChange={() => {}} />);
    expect(screen.getByTestId('portrait').textContent).toBe('Doing: does it with a reference or checklist.');
  });

  it('shows extra controls (e.g. the dispute flag) only inside "Needs adjusting"', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} adjustExtras={<button type="button">Flag this reading</button>} />);
    expect(screen.queryByRole('button', { name: /flag this reading/i })).toBeNull();
    expand();
    expect(screen.getByRole('button', { name: /flag this reading/i })).toBeInTheDocument();
  });
});
