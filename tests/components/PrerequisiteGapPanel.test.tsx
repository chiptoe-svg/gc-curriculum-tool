import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import type { CareerTarget, PrerequisiteGap } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations', name: 'Production & Ops',
  shortDefinition: '', industryContexts: [],
  knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
  defensibilityNote: '', socCode: null,
  subCompetencies: [
    { id: 'workflow-design', name: 'Workflow design', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
    { id: 'quality-control', name: 'Quality control', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
  ],
};

const gaps: PrerequisiteGap[] = [
  { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', priorCourseworkEvidence: 'Prior coursework develops it at Do level.', reasoning: 'Prereq is met because the prior coursework exceeds the expected level.' },
  { subCompetencyId: 'quality-control', expectedKudLevel: 'understand', status: 'missing', priorCourseworkEvidence: 'Nothing in the prior coursework addresses this.', reasoning: 'No prior course covers quality control; this course will be teaching it from zero.' },
];

describe('PrerequisiteGapPanel', () => {
  it('renders one row per gap with status badge', () => {
    render(<PrerequisiteGapPanel target={target} gaps={gaps} onFlag={vi.fn()} />);
    expect(screen.getByText(/Workflow design/i)).toBeInTheDocument();
    expect(screen.getByText(/Quality control/i)).toBeInTheDocument();
    expect(screen.getByText(/Met/i)).toBeInTheDocument();
    expect(screen.getByText(/Missing/i)).toBeInTheDocument();
  });
});
