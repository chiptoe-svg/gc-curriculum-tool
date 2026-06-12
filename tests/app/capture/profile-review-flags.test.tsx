import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompetencyFlagButton } from '@/app/capture/[code]/ProfileReviewPanel';

describe('CompetencyFlagButton', () => {
  it('opens the dialog and POSTs a profile_competency flag with frozen context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('gc-flagger-name', 'Erica Walker');
    render(
      <CompetencyFlagButton
        courseCode="GC 1010"
        slug="s"
        competency={{ statement: 'Mixes spot-color inks', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 4, evidence_k: 'x', evidence_u: 'y', evidence_d: 'z', rationale: 'r', source: 'materials' } as never}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /flag/i }));
    fireEvent.change(screen.getByPlaceholderText(/specifically wrong/i), { target: { value: 'U is too generous' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.targetKind).toBe('profile_competency');
    expect(body.competencyStatement).toBe('Mixes spot-color inks');
    expect(body.careerTargetId).toBeNull();
    expect(body.flaggedContext).toMatchObject({ k: 3, u: 2, d: 4, statement: 'Mixes spot-color inks' });
  });
});
