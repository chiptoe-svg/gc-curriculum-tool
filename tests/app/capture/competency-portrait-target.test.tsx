import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompetencyPortrait } from '@/app/capture/[code]/CompetencyPortrait';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

const comp = { statement: 'Prepress prep', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x', k_says: null, u_says: null, d_says: 'They do it.', intended_target: { k: null, u: null, d: 4 } } as unknown as CaptureCompetency;

it('shows the intended target in words when a target is present', () => {
  render(<CompetencyPortrait competency={comp} onChange={() => {}} />);
  const line = screen.getByTestId('intended-target');
  expect(line.textContent).toBe('The course aims for more — Doing: adapts it to new conditions.');
  expect(line.textContent).not.toMatch(/\b[KUD][0-5]\b/);
});

it('renders no target line when intended_target is absent', () => {
  const bare = { ...comp, intended_target: null } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={bare} onChange={() => {}} />);
  expect(screen.queryByTestId('intended-target')).toBeNull();
});

it('shows a Knowing/Reasoning target only when it differs from the measured depth', () => {
  // k target (3) differs from measured k_depth (2) → shown; u target (2) equals measured u_depth (2) → hidden
  const c = { ...comp, k_depth: 2, u_depth: 2, d_depth: 3, intended_target: { k: 3, u: 2, d: 4 } } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={c} onChange={() => {}} />);
  const text = screen.getByTestId('intended-target').textContent ?? '';
  expect(text).toMatch(/Knowing: recalls it without prompting/);
  expect(text).toMatch(/Doing: adapts it to new conditions/);
  expect(text).not.toMatch(/Reasoning/);
});

it('renders no target line when every target field is null', () => {
  const allNull = { ...comp, intended_target: { k: null, u: null, d: null } } as unknown as CaptureCompetency;
  render(<CompetencyPortrait competency={allNull} onChange={() => {}} />);
  expect(screen.queryByTestId('intended-target')).toBeNull();
});
