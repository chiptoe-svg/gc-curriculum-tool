import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

const comp = { statement: 'Prepress prep', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x', k_says: null, u_says: null, d_says: 'They do it.', intended_target: { k: null, u: null, d: 4 } } as unknown as CaptureCompetency;

it('shows the intended target vs measured when a target is present', () => {
  render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
  expect(screen.getByText(/target/i)).toBeInTheDocument();
  expect(screen.getByText(/D4/)).toBeInTheDocument();      // target D
  expect(screen.getByText(/measured|now/i)).toBeInTheDocument();
});

it('renders no target line when intended_target is absent', () => {
  const bare = { ...comp, intended_target: null } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={bare} onChange={() => {}} />);
  expect(screen.queryByText(/target/i)).not.toBeInTheDocument();
});

it('shows a K/U target segment only when it differs from the measured depth', () => {
  // k target (3) differs from measured k_depth (2) → shown; u target (2) equals measured u_depth (2) → hidden
  const c = { ...comp, k_depth: 2, u_depth: 2, d_depth: 3, intended_target: { k: 3, u: 2, d: 4 } } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={c} onChange={() => {}} />);
  const line = screen.getByText(/target/i).closest('p') as HTMLElement;
  // Split on "measured" — the target segment is everything before it.
  const targetSegment = (line.textContent ?? '').split(/measured/i)[0];
  expect(targetSegment).toMatch(/K3/);        // differing K target shown
  expect(targetSegment).toMatch(/D4/);        // D target always shown
  expect(targetSegment).not.toMatch(/U/);     // equal U target suppressed from the target segment
});

it('renders no target line when every target field is null', () => {
  const allNull = { ...comp, intended_target: { k: null, u: null, d: null } } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={allNull} onChange={() => {}} />);
  expect(screen.queryByText(/target/i)).not.toBeInTheDocument();
});
