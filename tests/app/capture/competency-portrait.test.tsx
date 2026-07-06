import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';

const comp: CaptureCompetency = {
  statement: 'Analyze packaging requirements',
  type: 'technical',
  k_depth: 4, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz', evidence_u: 'memo', evidence_d: 'project',
  rationale: 'x',
  k_says: 'They use the right terms.', u_says: 'They explain why.', d_says: 'They do it on familiar cases.',
};

describe('CompetencyPortrait', () => {
  it('shows the woven portrait sentences and a muted rating', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    expect(screen.getByText(/They use the right terms\./)).toBeInTheDocument();
    expect(screen.getByText(/K4 · U2 · D3/)).toBeInTheDocument();
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('hides the flag row until "Something\'s off"', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    expect(screen.queryByText('Reasoning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });

  it('"too high" applies a lower depth immediately, no evidence needed', () => {
    const onChange = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: /too high/i }));
    fireEvent.click(screen.getByRole('button', { name: /Restates the explanation as given/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 1 }));
  });

  it('"too low" is gated: raises depth only after evidence is entered, and writes evidence_u', () => {
    const onChange = vi.fn();
    render(<CompetencyPortrait competency={comp} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-u');
    fireEvent.click(within(row).getByRole('button', { name: /too low/i }));
    const commit = screen.getByRole('button', { name: /raise/i });
    expect(commit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /evidence/i }), { target: { value: 'unit-3 exam Q7, class mean 82%' } });
    expect(commit).toBeEnabled();
    fireEvent.click(commit);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ u_depth: 3, evidence_u: 'unit-3 exam Q7, class mean 82%' }));
  });

  it('can dismiss the flag row after opening it', () => {
    render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.queryByText('Reasoning')).toBeNull();
  });

  it('renders Do-only for a foundational competency', () => {
    const f: CaptureCompetency = { ...comp, type: 'foundational', k_depth: null, u_depth: null, k_says: null, u_says: null, d_says: 'Consistently attends to detail.' };
    render(<CompetencyPortrait competency={f} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    expect(screen.getByText('Doing')).toBeInTheDocument();
    expect(screen.queryByText('Naming')).toBeNull();
    expect(screen.queryByText('Reasoning')).toBeNull();
  });

  it('hides "too low" for a dimension already at depth 5 (ceiling)', () => {
    const maxed = { ...comp, d_depth: 5 };
    render(<CompetencyPortrait competency={maxed} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-d');
    expect(within(row).queryByRole('button', { name: /too low/i })).toBeNull();
    expect(within(row).getByRole('button', { name: /too high/i })).toBeInTheDocument();
  });

  it('hides "too high" for a dimension at depth 0 (floor)', () => {
    const zero = { ...comp, d_depth: 0 };
    render(<CompetencyPortrait competency={zero} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /something's off/i }));
    const row = screen.getByTestId('flag-row-d');
    expect(within(row).queryByRole('button', { name: /too high/i })).toBeNull();
    expect(within(row).getByRole('button', { name: /too low/i })).toBeInTheDocument();
  });
});
