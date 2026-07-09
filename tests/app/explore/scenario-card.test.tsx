import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ScenarioCard } from '@/app/explore/[code]/ScenarioCard';
import type { Scenario } from '@/lib/ai/explore/scenario';

const scenario: Scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'b',
  change: { prose: 'add a trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: ['registration'], assumesIncoming: [] },
  predictedDeltas: [{ competency: 'prepress preparation', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc', label: 'trapping', before: 'gap', after: 'met' }],
  caption: null, createdAt: '2026-07-08T00:00:00.000Z',
} as Scenario;

describe('ScenarioCard', () => {
  it('renders the change, a predicted delta, and a ripple line', () => {
    render(<ScenarioCard scenario={scenario} onSave={() => {}} onCompare={() => {}} />);
    expect(screen.getByText(/trapping lab/)).toBeInTheDocument();          // header/change
    expect(screen.getByText(/prepress preparation/)).toBeInTheDocument();  // delta
    expect(screen.getByText(/D3\s*→\s*4/)).toBeInTheDocument();            // delta D
    const ripple = screen.getByTestId('scenario-ripple');
    expect(within(ripple).getByText(/trapping/)).toBeInTheDocument();      // ripple label VISIBLE
    expect(within(ripple).getByText(/gap\s*→\s*met/)).toBeInTheDocument(); // ripple before→after
    expect(within(ripple).getByText(/GC 4440/)).toBeInTheDocument();       // ripple courseCode visible
  });
  it('fires onSave and onCompare; Adopt is disabled', () => {
    const onSave = vi.fn(); const onCompare = vi.fn();
    render(<ScenarioCard scenario={scenario} onSave={onSave} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    expect(onSave).toHaveBeenCalledWith('s1');
    expect(onCompare).toHaveBeenCalledWith('s1');
    expect(screen.getByRole('button', { name: /adopt/i })).toBeDisabled();
  });
  it('fires onAdopt and is enabled when onAdopt is provided', () => {
    const onAdopt = vi.fn();
    render(<ScenarioCard scenario={scenario} onSave={() => {}} onCompare={() => {}} onAdopt={onAdopt} />);
    const adoptBtn = screen.getByRole('button', { name: /adopt/i });
    expect(adoptBtn).not.toBeDisabled();
    fireEvent.click(adoptBtn);
    expect(onAdopt).toHaveBeenCalledWith('s1');
  });
});
