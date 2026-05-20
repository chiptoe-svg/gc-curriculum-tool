import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetChainForm } from '@/components/TargetChainForm';

const targets = [
  { id: 'production-operations', name: 'Production Operations' },
  { id: 'brand-strategy', name: 'Brand Strategy' },
];

const courses = [
  { code: 'GC 1010', title: 'Intro', level: 1, track: 'core', syllabusText: 'syllabus 1010 body that is long enough fifty chars min' },
  { code: 'GC 2020', title: 'Mid', level: 2, track: 'core', syllabusText: 'syllabus 2020 body that is long enough fifty chars min' },
  { code: 'GC 4060', title: 'Senior', level: 4, track: 'core', syllabusText: 'syllabus 4060 body that is long enough fifty chars min' },
];

describe('TargetChainForm', () => {
  it('renders the career target picker and the checkbox list grouped by level', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    expect(screen.getByLabelText(/career target/i)).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
    expect(screen.getByLabelText(/GC 1010/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GC 4060/i)).toBeInTheDocument();
  });

  it('disables Analyze until at least 2 courses are selected', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /Analyze/i });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/GC 2020/i));
    expect(btn).not.toBeDisabled();
  });

  it('shows a counter and enforces 16-course cap', () => {
    const many = Array.from({ length: 16 }, (_, i) => ({
      code: `GC 1${String(i).padStart(3, '0')}`,
      title: `Course ${i}`, level: 1, track: 'core',
      syllabusText: 'a'.repeat(60),
    }));
    const overflow = { ...many[0]!, code: 'GC 9999', title: 'extra' };
    render(<TargetChainForm slug="s" targets={targets} courses={[...many, overflow]} onAnalyze={() => {}} isAnalyzing={false} />);
    for (let i = 0; i < 16; i++) fireEvent.click(screen.getByLabelText(new RegExp(many[i]!.code, 'i')));
    expect(screen.getByText(/16 of 16/i)).toBeInTheDocument();
    // 17th checkbox should be disabled because cap is reached
    const overCheckbox = screen.getByLabelText(/GC 9999/i) as HTMLInputElement;
    expect(overCheckbox.disabled).toBe(true);
  });

  it('clears selections via the Clear all link', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    fireEvent.click(screen.getByLabelText(/GC 2020/i));
    expect(screen.getByText(/2 of 16/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Clear all/i));
    expect(screen.getByText(/0 of 16/i)).toBeInTheDocument();
  });

  it('calls onAnalyze with target + selected course payloads when clicked', () => {
    const onAnalyze = vi.fn();
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={onAnalyze} isAnalyzing={false} />);
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    fireEvent.click(screen.getByLabelText(/GC 4060/i));
    fireEvent.click(screen.getByRole('button', { name: /Analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: courses[0]!.syllabusText },
        { courseLabel: 'GC 4060', syllabusText: courses[2]!.syllabusText },
      ],
    });
  });
});
