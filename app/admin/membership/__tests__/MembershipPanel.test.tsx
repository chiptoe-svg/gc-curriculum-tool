import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MembershipPanel } from '../MembershipPanel';
import type { ListedCompetency } from '@/lib/db/membership-queries';

const row = (competencyId: string, o: Partial<ListedCompetency>): ListedCompetency => ({
  careerTargetId: 't1', competencyId, name: competencyId.toUpperCase(), weight: null, band: null, pinned: false, hidden: false, member: false, displayOrder: null, provisional: false, reason: null, ...o,
});
const rows = [
  row('pinned-one', { pinned: true, member: true, displayOrder: 0 }),
  row('weighted', { weight: 0.8, band: 'very', member: true, displayOrder: 1, provisional: true, reason: 'Central to the daily work.' }),
  row('hidden-one', { weight: 0.9, band: 'very', hidden: true }),
];

let posts: Array<Record<string, unknown>>;
beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ ok: true, changes: [{}] }) };
    }
    void url;
    return { ok: true, json: async () => ({ targets: [{ id: 't1', name: 'Target One' }], rows }) };
  }));
});

describe('MembershipPanel', () => {
  it('shows pinned, weight-based and hidden rows with their status', async () => {
    render(<MembershipPanel slug="s" />);
    const pinned = (await screen.findByText('PINNED-ONE')).closest('tr')!;
    expect(within(pinned).getByText('Selected by faculty')).toBeTruthy();
    expect(within(pinned).getByText('Shown — pinned')).toBeTruthy();
    const weighted = screen.getByText('WEIGHTED').closest('tr')!;
    expect(within(weighted).getByText(/Very or extremely important \(0\.80\) · provisional/)).toBeTruthy();
    expect(within(pinned).queryByText(/provisional/)).toBeNull();
    expect(within(weighted).getByText('Central to the daily work.')).toBeTruthy();
    expect(within(weighted).getByText('Shown — by importance')).toBeTruthy();
    const hidden = screen.getByText('HIDDEN-ONE').closest('tr')!;
    expect(within(hidden).getByText('Hidden')).toBeTruthy();
    expect(within(hidden).getByRole('button', { name: 'Reset to importance only' })).toBeTruthy();
    expect(within(hidden).queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('Hide posts the action for that row', async () => {
    render(<MembershipPanel slug="s" />);
    const weighted = (await screen.findByText('WEIGHTED')).closest('tr')!;
    fireEvent.click(within(weighted).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(posts).toEqual([{ slug: 's', targetId: 't1', competencyId: 'weighted', action: 'hide' }]));
  });
});
