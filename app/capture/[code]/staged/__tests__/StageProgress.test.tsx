import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageProgress } from '../StageProgress';

const progress = [
  { id: 1, title: 'The course in your words', status: 'done' },
  { id: 2, title: 'Evidence walk', status: 'active' },
  { id: 3, title: 'When it goes wrong, and the leap', status: 'upcoming' },
  { id: 4, title: 'What students walk in with', status: 'upcoming' },
  { id: 5, title: 'Habits and communication', status: 'upcoming' },
  { id: 6, title: 'Objectives and close', status: 'upcoming' },
] as const;

describe('StageProgress', () => {
  it('shows "Stage N of 6 — title" for the active stage and six steps', () => {
    render(<StageProgress progress={[...progress]} questionsAsked={4} cap={20} />);
    expect(screen.getByText('Stage 2 of 6 — Evidence walk')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('marks done, active and upcoming', () => {
    render(<StageProgress progress={[...progress]} questionsAsked={4} cap={20} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map(i => i.getAttribute('data-status'))).toEqual(['done', 'active', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
  });

  it('shows how many questions were asked, and never says slot', () => {
    const { container } = render(<StageProgress progress={[...progress]} questionsAsked={4} cap={20} />);
    expect(screen.getByText(/4 of up to 20 questions/)).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain('slot');
  });

  it('when every stage is done, names the last stage', () => {
    render(<StageProgress progress={progress.map(p => ({ ...p, status: 'done' as const }))} questionsAsked={16} cap={20} />);
    expect(screen.getByText('Stage 6 of 6 — Objectives and close')).toBeInTheDocument();
  });
});
