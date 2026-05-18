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

const prior1Scores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'know', confidence: 'medium', reasoning: 'Prior1 workflow reasoning here that is long enough.' },
  { subCompetencyId: 'quality-control', kudLevel: 'know', confidence: 'low', reasoning: 'Prior1 quality reasoning here.' },
];

const prior2Scores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Prior2 workflow reasoning here that is long enough.' },
  { subCompetencyId: 'quality-control', kudLevel: 'understand', confidence: 'medium', reasoning: 'Prior2 quality reasoning here.' },
];

const courseScores: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Course workflow reasoning here.' },
  { subCompetencyId: 'quality-control', kudLevel: 'do', confidence: 'high', reasoning: 'Course quality reasoning here.' },
];

describe('CoverageHeatMap', () => {
  it('renders one column per sub-competency and one row per course', () => {
    render(
      <CoverageHeatMap
        target={target}
        courseLabel="GC 4060"
        courseScores={courseScores}
        priorCoursework={[
          { courseLabel: 'GC 3460', coverage: prior2Scores },
        ]}
        onFlag={vi.fn()}
      />
    );
    expect(screen.getByText('GC 4060')).toBeInTheDocument();
    expect(screen.getByText('GC 3460')).toBeInTheDocument();
    expect(screen.getByText('Workflow design')).toBeInTheDocument();
    expect(screen.getByText('Quality control')).toBeInTheDocument();
  });

  it('renders the course row at the top, prior coursework rows below', () => {
    render(
      <CoverageHeatMap
        target={target}
        courseLabel="GC 4060"
        courseScores={courseScores}
        priorCoursework={[
          { courseLabel: 'GC 1040', coverage: prior1Scores },
          { courseLabel: 'GC 3460', coverage: prior2Scores },
        ]}
        onFlag={vi.fn()}
      />
    );
    // aria-hidden divider row is excluded from role='row' results
    // rows[0] = thead row, rows[1] = course row, rows[2] = prior1, rows[3] = prior2
    const rows = screen.getAllByRole('row');
    const courseRow = rows[1]!;
    const prior1Row = rows[2]!;
    expect(courseRow.textContent).toContain('GC 4060');
    expect(prior1Row.textContent).toContain('GC 1040');
    expect(screen.getByText('GC 3460')).toBeInTheDocument();
  });

  it('renders N+1 rows for a 2-prior-course set', () => {
    render(
      <CoverageHeatMap
        target={target}
        courseLabel="GC 4060"
        courseScores={courseScores}
        priorCoursework={[
          { courseLabel: 'GC 1040', coverage: prior1Scores },
          { courseLabel: 'GC 3460', coverage: prior2Scores },
        ]}
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
        courseLabel="GC 4060"
        courseScores={courseScores}
        priorCoursework={[
          { courseLabel: 'GC 3460', coverage: prior2Scores },
        ]}
        onFlag={vi.fn()}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^why\?$/i })[0]!);
    // The first button in DOM order is in the course row (GC 4060)
    expect(screen.getByText(/Course workflow reasoning/i)).toBeInTheDocument();
  });
});
