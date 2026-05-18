import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrototypeForm } from '@/components/PrototypeForm';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

// Mock fetch so the dropdown loads immediately from the seed-targets fixture
beforeAll(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => CAREER_TARGETS.map((t) => ({ id: t.id, name: t.name })),
  } as Response);
});

describe('PrototypeForm', () => {
  it('renders the course syllabus, prior coursework syllabus, career target and Analyze button', async () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    // Course (being analyzed) appears first — identified by its aria-label
    expect(screen.getByLabelText(/^course syllabus$/i)).toBeInTheDocument();
    // Prior coursework section follows
    expect(screen.getByLabelText(/^prior course 1 syllabus$/i)).toBeInTheDocument();
    // Wait for the async fetch to resolve so the Select renders instead of the loading text
    await waitFor(() => expect(screen.getByLabelText(/career target/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('disables Analyze when syllabi are blank', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /analyze/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAnalyze with course and priorCoursework when submitted', async () => {
    const onAnalyze = vi.fn();
    render(<PrototypeForm onAnalyze={onAnalyze} isAnalyzing={false} />);
    // Fill in the course (being analyzed) — aria-label "Course label" is unique to the course input
    fireEvent.change(screen.getByLabelText(/^course label$/i), { target: { value: 'GC 4060' } });
    fireEvent.change(screen.getByLabelText(/^course syllabus$/i), { target: { value: 'B'.repeat(100) } });
    // Fill in prior course 1 label and syllabus — specific "Prior course 1" aria-labels
    fireEvent.change(screen.getByLabelText(/^prior course 1 label$/i), { target: { value: 'GC 3460' } });
    fireEvent.change(screen.getByLabelText(/^prior course 1 syllabus$/i), { target: { value: 'A'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: expect.any(String),
      course: { courseLabel: 'GC 4060', syllabusText: 'B'.repeat(100) },
      priorCoursework: [{ courseLabel: 'GC 3460', syllabusText: 'A'.repeat(100) }],
    });
  });

  it('Add prior course button adds a second prior course row', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    // Initially only 1 prior course syllabus textarea
    expect(screen.queryByLabelText(/prior course 2 syllabus/i)).not.toBeInTheDocument();
    // Click "Add prior course"
    fireEvent.click(screen.getByRole('button', { name: /add prior course/i }));
    // Now there should be a second prior course syllabus textarea
    expect(screen.getByLabelText(/prior course 2 syllabus/i)).toBeInTheDocument();
  });
});
