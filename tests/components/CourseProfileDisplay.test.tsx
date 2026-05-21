import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CourseProfileDisplay } from '@/components/CourseProfileDisplay';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

const profile: CourseProfileResult = {
  summary: 'Develops press-floor fluency through high-stakes assignments.',
  learningObjectives: [
    'Operate an 8-color press through make-ready and a 10k-impression run.',
    'Identify and resolve color deviation using spectrophotometric data.',
  ],
  skills: ['Spectrophotometry', 'Pantone Live', 'ICC profile generation'],
  competencies: [
    {
      name: 'Color management',
      description: 'Hit delta-E ≤ 2.0 on a live press check.',
      level: 'developed',
      evidence: [
        { fileName: 'rubric.pdf', quote: 'Student must achieve delta-E of ≤ 2.0 on the press check.' },
      ],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Spectrophotometric measurement'],
    gaps: ['Bindery operations'],
  },
};

describe('CourseProfileDisplay', () => {
  it('renders the summary text', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/develops press-floor fluency/i)).toBeTruthy();
  });

  it('renders all learning objectives', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/operate an 8-color press/i)).toBeTruthy();
    expect(screen.getByText(/spectrophotometric data/i)).toBeTruthy();
  });

  it('renders all skills', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText('Spectrophotometry')).toBeTruthy();
    expect(screen.getByText('Pantone Live')).toBeTruthy();
  });

  it('renders competencies with name, level, and evidence', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText('Color management')).toBeTruthy();
    expect(screen.getByText(/developed/i)).toBeTruthy();
    expect(screen.getByText(/delta-E of ≤ 2\.0/i)).toBeTruthy();
    expect(screen.getByText(/rubric\.pdf/i)).toBeTruthy();
  });

  it('renders the catalogDivergence panel with all three sections', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/catalog divergence/i)).toBeTruthy();
    expect(screen.getByText('Color theory')).toBeTruthy();
    expect(screen.getByText('Spectrophotometric measurement')).toBeTruthy();
    expect(screen.getByText('Bindery operations')).toBeTruthy();
  });

  it('renders a placeholder when no profile is provided', () => {
    render(<CourseProfileDisplay profile={null} />);
    expect(screen.getByText(/no profile yet/i)).toBeTruthy();
  });
});
