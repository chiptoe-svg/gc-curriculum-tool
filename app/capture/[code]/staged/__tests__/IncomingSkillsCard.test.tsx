import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncomingSkillsCard } from '../IncomingSkillsCard';

describe('IncomingSkillsCard', () => {
  it('offers three choices per skill', () => {
    render(<IncomingSkillsCard skills={['Color theory', 'Imposition']} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getAllByText('arrives able')).toHaveLength(2);
    expect(screen.getAllByText('needs a refresher')).toHaveLength(2);
    expect(screen.getAllByText('learned here')).toHaveLength(2);
  });

  it('submits one line per skill as "<skill>: <choice>"', () => {
    const onSubmit = vi.fn();
    render(<IncomingSkillsCard skills={['Color theory', 'Imposition', 'Press math']} onSubmit={onSubmit} />);
    const radios = (skill: string, choice: string) => screen.getByRole('radio', { name: `${skill}: ${choice}` });
    fireEvent.click(radios('Color theory', 'arrives able'));
    fireEvent.click(radios('Imposition', 'needs a refresher'));
    fireEvent.click(radios('Press math', 'learned here'));
    fireEvent.click(screen.getByRole('button', { name: 'Send these answers' }));
    expect(onSubmit).toHaveBeenCalledWith('Color theory: arrives able\nImposition: needs a refresher\nPress math: learned here');
  });

  it('cannot send until a skill has a choice, and leaves unchosen skills out', () => {
    const onSubmit = vi.fn();
    render(<IncomingSkillsCard skills={['A', 'B']} onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: 'Send these answers' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'B: learned here' }));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith('B: learned here');
  });

  it('can be disabled while a turn is running', () => {
    render(<IncomingSkillsCard skills={['A']} onSubmit={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole('radio', { name: 'A: learned here' }));
    expect(screen.getByRole('button', { name: 'Send these answers' })).toBeDisabled();
  });
});
