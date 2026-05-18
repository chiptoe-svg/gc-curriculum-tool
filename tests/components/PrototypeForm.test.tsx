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
  it('renders the upstream syllabus, downstream syllabus, career target and Analyze button', async () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    // There should be at least one upstream syllabus textarea
    expect(screen.getByLabelText(/upstream course 1 syllabus/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/downstream course syllabus/i)).toBeInTheDocument();
    // Wait for the async fetch to resolve so the Select renders instead of the loading text
    await waitFor(() => expect(screen.getByLabelText(/career target/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('disables Analyze when syllabi are blank', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /analyze/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAnalyze with upstreamChain when submitted', async () => {
    const onAnalyze = vi.fn();
    render(<PrototypeForm onAnalyze={onAnalyze} isAnalyzing={false} />);
    // Fill in the upstream label and syllabus
    fireEvent.change(screen.getByLabelText(/upstream course 1 label/i), { target: { value: 'GC 3460' } });
    fireEvent.change(screen.getByLabelText(/upstream course 1 syllabus/i), { target: { value: 'A'.repeat(100) } });
    // Fill in the downstream label and syllabus
    fireEvent.change(screen.getByLabelText(/downstream course label/i), { target: { value: 'GC 4060' } });
    fireEvent.change(screen.getByLabelText(/downstream course syllabus/i), { target: { value: 'B'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: expect.any(String),
      upstreamChain: [{ courseLabel: 'GC 3460', syllabusText: 'A'.repeat(100) }],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'B'.repeat(100) },
    });
  });

  it('Add upstream course button adds a second row', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    // Initially only 1 upstream syllabus textarea
    expect(screen.queryByLabelText(/upstream course 2 syllabus/i)).not.toBeInTheDocument();
    // Click "Add upstream course"
    fireEvent.click(screen.getByRole('button', { name: /add upstream course/i }));
    // Now there should be a second upstream syllabus textarea
    expect(screen.getByLabelText(/upstream course 2 syllabus/i)).toBeInTheDocument();
  });
});
