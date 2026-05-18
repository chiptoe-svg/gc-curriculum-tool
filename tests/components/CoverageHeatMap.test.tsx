import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import type { CareerTarget, CoverageScore } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production & Ops',
  shortDefinition: '',
  industryContexts: [],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: '',
  socCode: null,
  subCompetencies: [
    { id: 'workflow-design', name: 'Workflow design', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
    { id: 'quality-control', name: 'Quality control', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
  ],
};

const upstream1Scores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'know', confidence: 'medium', reasoning: 'Upstream1 workflow reasoning here that is long enough.' },
  { subCompetencyId: 'quality-control', kudLevel: 'know', confidence: 'low', reasoning: 'Upstream1 quality reasoning here.' },
];

const upstream2Scores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Upstream2 workflow reasoning here that is long enough.' },
  { subCompetencyId: 'quality-control', kudLevel: 'understand', confidence: 'medium', reasoning: 'Upstream2 quality reasoning here.' },
];

const downstreamScores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Downstream workflow reasoning here.' },
  { subCompetencyId: 'quality-control', kudLevel: 'do', confidence: 'high', reasoning: 'Downstream quality reasoning here.' },
];

describe('CoverageHeatMap', () => {
  it('renders one column per sub-competency and one row per course', () => {
    render(
      <CoverageHeatMap
        target={target}
        upstreamChain={[
          { courseLabel: 'GC 3460', coverage: upstream2Scores },
        ]}
        downstreamLabel="GC 4060"
        downstreamScores={downstreamScores}
        onFlag={vi.fn()}
      />
    );
    expect(screen.getByText('GC 3460')).toBeInTheDocument();
    expect(screen.getByText('GC 4060')).toBeInTheDocument();
    expect(screen.getByText('Workflow design')).toBeInTheDocument();
    expect(screen.getByText('Quality control')).toBeInTheDocument();
  });

  it('renders N+1 rows for a 2-upstream chain', () => {
    render(
      <CoverageHeatMap
        target={target}
        upstreamChain={[
          { courseLabel: 'GC 1040', coverage: upstream1Scores },
          { courseLabel: 'GC 3460', coverage: upstream2Scores },
        ]}
        downstreamLabel="GC 4060"
        downstreamScores={downstreamScores}
        onFlag={vi.fn()}
      />
    );
    expect(screen.getByText('GC 1040')).toBeInTheDocument();
    expect(screen.getByText('GC 3460')).toBeInTheDocument();
    expect(screen.getByText('GC 4060')).toBeInTheDocument();
  });

  it('expands reasoning when a cell is clicked', () => {
    render(
      <CoverageHeatMap
        target={target}
        upstreamChain={[
          { courseLabel: 'GC 3460', coverage: upstream2Scores },
        ]}
        downstreamLabel="GC 4060"
        downstreamScores={downstreamScores}
        onFlag={vi.fn()}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: /show ai reasoning/i })[0]!);
    expect(screen.getByText(/Upstream2 workflow reasoning/i)).toBeInTheDocument();
  });
});
