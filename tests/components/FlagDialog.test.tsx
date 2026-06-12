import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagDialog } from '@/components/FlagDialog';

beforeEach(() => { localStorage.clear(); });

describe('FlagDialog', () => {
  it('submits note + selected roster name and persists the name', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={onSubmit} context="GC 1010 × Color Management" />);
    fireEvent.change(screen.getByLabelText(/flagging as/i), { target: { value: 'Erica Walker' } });
    fireEvent.change(screen.getByPlaceholderText(/specifically wrong/i), { target: { value: 'Depth overstated' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Depth overstated', 'Erica Walker'));
    expect(localStorage.getItem('gc-flagger-name')).toBe('Erica Walker');
  });

  it('disables submit until both a name and a note are present', () => {
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={vi.fn(async () => {})} context="ctx" />);
    expect((screen.getByRole('button', { name: /submit flag/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pre-selects the remembered name from localStorage', () => {
    localStorage.setItem('gc-flagger-name', 'Chip Tonkin');
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={vi.fn(async () => {})} context="ctx" />);
    expect((screen.getByLabelText(/flagging as/i) as HTMLSelectElement).value).toBe('Chip Tonkin');
  });
});
