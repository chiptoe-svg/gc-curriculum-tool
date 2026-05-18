import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrototypeForm } from '@/components/PrototypeForm';

describe('PrototypeForm', () => {
  it('renders the three inputs and the Analyze button', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    expect(screen.getByLabelText(/upstream course/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/downstream course/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/career target/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('disables Analyze when syllabi are blank', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /analyze/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAnalyze with the values when submitted', async () => {
    const onAnalyze = vi.fn();
    render(<PrototypeForm onAnalyze={onAnalyze} isAnalyzing={false} />);
    fireEvent.change(screen.getByLabelText(/upstream course syllabus/i), { target: { value: 'A'.repeat(100) } });
    fireEvent.change(screen.getByLabelText(/downstream course syllabus/i), { target: { value: 'B'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: expect.any(String),
      upstream: { courseLabel: '', syllabusText: 'A'.repeat(100) },
      downstream: { courseLabel: '', syllabusText: 'B'.repeat(100) },
    });
  });
});
