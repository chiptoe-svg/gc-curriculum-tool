// Owner, 2026-10-07: after moving a read file, the step offers to read it again.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn(async () => null) }));

import { TriageStep } from '@/app/capture/[code]/TriageStep';

describe('triage — moving a read file', () => {
  it('marks it unread so the button reads it again at the new level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, indexingStatus: 'pending' }) }));
    const mat = { id: 'm1', fileName: 'Deck.pdf', mimeType: 'application/pdf', tier: 'high', indexingStatus: 'ready', ignored: false, pageCount: 10 } as never;
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[mat]} onIngested={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: /continue to interview/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /move down/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /read files & continue/i })).toBeTruthy());
    vi.unstubAllGlobals();
  });
});
