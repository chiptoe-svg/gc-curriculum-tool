import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ComparisonCard } from '@/app/explore/[code]/ComparisonCard';

it('renders which deltas and ripple lines differ', () => {
  render(<ComparisonCard
    aCaption="trapping v1" bCaption="trapping v2"
    diff={{
      deltaChanges: [{ competency: 'prepress', aTo: { k: 2, u: 2, d: 4 }, bTo: { k: 2, u: 2, d: 5 } }],
      rippleOnlyInA: [{ kind: 'downstream_gap', label: 'trapping', before: 'gap', after: 'met' } as any],
      rippleOnlyInB: [],
    }} />);
  const header = screen.getByTestId('comparison-header');
  expect(within(header).getByText(/trapping v1/)).toBeInTheDocument();
  expect(within(header).getByText(/trapping v2/)).toBeInTheDocument();
  expect(screen.getByText(/prepress/)).toBeInTheDocument();
  const onlyA = screen.getByTestId('only-in-a');
  expect(within(onlyA).getByText(/Only in .*trapping v1/)).toBeInTheDocument(); // heading VISIBLE
  expect(within(onlyA).getByText(/trapping:/)).toBeInTheDocument();             // ripple line VISIBLE
});
