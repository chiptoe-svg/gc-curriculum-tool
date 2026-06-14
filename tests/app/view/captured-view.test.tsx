import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapturedView } from '@/app/view/[code]/CapturedView';

const base = { capturedAt: '2026-06-14T00:00:00.000Z' };

describe('CapturedView — apparent outcomes + incoming depths', () => {
  it('renders the Apparent outcomes section from revised_objectives_draft', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], revised_objectives_draft: ['Students prepare production-ready artwork'] }} {...base} />);
    expect(screen.getByText(/Apparent outcomes/i)).toBeTruthy();
    expect(screen.getByText(/production-ready artwork/i)).toBeTruthy();
  });
  it('omits Apparent outcomes when null/empty', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], revised_objectives_draft: null }} {...base} />);
    expect(screen.queryByText(/Apparent outcomes/i)).toBeNull();
  });
  it('shows K/U/D chips on incoming expectations', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }], incoming_expectations: [{ statement: 'Spot-color basics', expected_depth: { k: 2, u: null, d: 3 } }] }} {...base} />);
    expect(screen.getByText(/Spot-color basics/i)).toBeTruthy();
    expect(screen.getAllByTitle(/Do — depth 3/i).length).toBeGreaterThan(0);
    expect(screen.getByTitle(/Know — depth 2/i)).toBeTruthy();
  });
});
