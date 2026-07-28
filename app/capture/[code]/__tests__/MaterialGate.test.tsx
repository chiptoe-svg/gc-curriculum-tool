import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterialGate } from '../MaterialGate';

const flags = [
  { id: 'a', fileName: 'deck.pdf', kind: 'extraction-failed' as const, facultyNote: null },
  { id: 'b', fileName: 'WK1.pdf', kind: 'ferpa-held' as const, facultyNote: null },
];

describe('MaterialGate', () => {
  it('renders grouped flags + a single Continue and fires notes on continue', () => {
    const onContinue = vi.fn();
    render(<MaterialGate flags={flags} onContinue={onContinue} onBack={() => {}} />);
    expect(screen.getByText(/deck\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/WK1\.pdf/)).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'ok to skip' } });
    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(onContinue).toHaveBeenCalledWith({ a: 'ok to skip' }, []);
  });

  it('ferpa item exposes an include-anyway control that adds to the include list', () => {
    const onContinue = vi.fn();
    render(<MaterialGate flags={flags} onContinue={onContinue} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /include anyway/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(onContinue).toHaveBeenCalledWith({}, ['b']);
  });
});
