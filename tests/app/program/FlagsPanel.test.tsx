import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagsPanel, type AnnotatedFlag } from '@/app/program/FlagsPanel';

function flag(o: Partial<AnnotatedFlag>): AnnotatedFlag {
  return {
    id: o.id ?? 'f1', targetKind: 'coverage_cell', courseCode: 'GC 1010',
    careerTargetId: 't1', subCompetencyId: 'color-management', competencyStatement: null,
    note: 'overstated', flaggedBy: 'Erica Walker',
    flaggedContext: { k: 1, u: 1, d: 4 }, status: 'open',
    resolvedBy: null, resolvedAt: null, resolutionNote: null,
    createdAt: new Date().toISOString(),
    drift: o.drift ?? null, stillInMatrix: o.stillInMatrix ?? true,
    ...o,
  } as AnnotatedFlag;
}

describe('FlagsPanel', () => {
  it('renders drift line when the score moved since flagging', () => {
    render(<FlagsPanel flags={[flag({ drift: [{ dim: 'd', was: 4, now: 2 }] })]} slug="s" onChanged={() => {}} />);
    expect(screen.getByText(/was D=4 → now D=2/i)).toBeTruthy();
  });

  it('annotates flags whose cell left the matrix', () => {
    render(<FlagsPanel flags={[flag({ stillInMatrix: false })]} slug="s" onChanged={() => {}} />);
    expect(screen.getByText(/no longer in matrix/i)).toBeTruthy();
  });

  it('resolve PATCHes with name + note and calls onChanged', async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlagsPanel flags={[flag({})]} slug="s" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    fireEvent.change(screen.getByLabelText(/resolving as/i), { target: { value: 'Chip Tonkin' } });
    fireEvent.change(screen.getByPlaceholderText(/resolution note/i), { target: { value: 'agree after re-score' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm resolve/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/flags/f1');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
