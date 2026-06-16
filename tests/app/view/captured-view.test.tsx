import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapturedView } from '@/app/view/[code]/CapturedView';

const base = { capturedAt: '2026-06-14T00:00:00.000Z' };

describe('CapturedView — full profile sections', () => {
  const profile = {
    competencies: [{ statement: 'x', d_depth: 3 }],
    class_structure: { topics: ['Color', 'Prepress'], cadence: 'weekly 2-hour lab', assessment: 'Two projects + a final.' },
    major_projects: [{ title: 'Brand Color Report', description: 'Students measure and report color across media.', competencies: ['color management'] }],
    course_emphasis: [{ competency: 'Color management', points: 120, share_pct: 40, centrality: 'central' as const }],
  };
  it('renders class structure (topics, cadence, assessment)', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Class structure/i)).toBeTruthy();
    expect(screen.getByText(/Prepress/)).toBeTruthy();
    expect(screen.getByText(/weekly 2-hour lab/)).toBeTruthy();
    expect(screen.getByText(/Two projects \+ a final/)).toBeTruthy();
  });
  it('renders major projects', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Major projects/i)).toBeTruthy();
    expect(screen.getByText(/Brand Color Report/)).toBeTruthy();
  });
  it('renders course emphasis with centrality band (not precise points/percent)', () => {
    render(<CapturedView profile={profile} {...base} />);
    expect(screen.getByText(/Course emphasis/i)).toBeTruthy();
    expect(screen.getByText(/central/i)).toBeTruthy();
    expect(screen.getByText(/Color management/)).toBeTruthy();
    expect(screen.queryByText(/40%/)).toBeNull();
  });
  it('omits each section when its field is null/absent', () => {
    render(<CapturedView profile={{ competencies: [{ statement: 'x', d_depth: 3 }] }} {...base} />);
    expect(screen.queryByText(/Class structure/i)).toBeNull();
    expect(screen.queryByText(/Major projects/i)).toBeNull();
    expect(screen.queryByText(/Course emphasis/i)).toBeNull();
  });
});

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
