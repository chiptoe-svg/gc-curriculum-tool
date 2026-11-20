import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { SkillTreePanel } from '@/app/build/shared/SkillTreePanel';
import type { Tree } from '@/lib/skill-tree/types';

const node = (id: string, name: string, parentId: string | null, over: object = {}) => ({
  id, name, description: null, parentId, competencyId: null, foundational: false, weight: 1,
  weightSource: 'default' as const, mergedInto: null, retired: false, ...over,
});
const leaf = (skillRef: string, nodeId: string, statement: string) => ({
  courseCode: 'GC 1010', skillRef, nodeId, statement, share: null, source: 'faculty' as const, status: 'confirmed' as const,
});

const baseTree = (): Tree => ({
  nodes: [node('r', 'Print production', null), node('icc', 'ICC profile building', 'r'), node('ag', 'Agency', 'r', { foundational: true })],
  leaves: [leaf('a', 'icc', 'Build a profile'), leaf('c', 'ag', 'Own the outcome'), leaf('old', 'icc', 'Old wording')],
  depths: [],
});

const versions = () => [{
  instructor: 'Dr Who', snapshotId: 's1',
  skills: [
    { skillRef: 'a', statement: 'Build a profile', k: 2, u: 2, d: 3 },
    { skillRef: 'b', statement: 'Calibrate a press', k: 1, u: 1, d: 2 },
    { skillRef: 'c', statement: 'Own the outcome', k: 1, u: 1, d: 3 },
  ],
  gone: [{ skillRef: 'old', statement: 'Old wording', suggestion: { skillRef: 'b', statement: 'Calibrate a press', similarity: 0.9 } }],
}];

function mockFetch(tree: Tree, post?: () => { ok: boolean; status?: number; json: unknown }) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      calls.push({ url, body: JSON.parse(init.body!) });
      const r = post?.() ?? { ok: true, json: { tree, notes: [] } };
      return { ok: r.ok, status: r.status ?? 200, json: async () => r.json };
    }
    return { ok: true, status: 200, json: async () => ({ tree, versions: versions(), suggestions: { b: [{ nodeId: 'icc', similarity: 0.8 }] } }) };
  }));
  return calls;
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe('SkillTreePanel', () => {
  it('lists unplaced skills with their suggestions and places one', async () => {
    const calls = mockFetch(baseTree());
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    await screen.findByText('Place these skills');
    fireEvent.click(await screen.findByRole('button', { name: 'Put under ICC profile building' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'place', courseCode: 'GC 1010', skillRef: 'b', nodeId: 'icc' });
  });

  it('shows a gone skill with its new wording and confirms a retarget', async () => {
    const calls = mockFetch(baseTree());
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    await screen.findByText('No longer in the capture');
    expect(screen.getByText(/Same skill, reworded: Calibrate a press/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'retarget', courseCode: 'GC 1010', oldRef: 'old', newRef: 'b' });
  });

  it('foundational nodes show D only', async () => {
    mockFetch(baseTree());
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    const row = (await screen.findByText('Agency')).closest('[data-node]') as HTMLElement;
    expect(within(row).getByText('D3')).toBeTruthy();
    expect(within(row).queryByText(/K\d/)).toBeNull();
  });

  it('hand-set row shows set by hand and the suggestion', async () => {
    const t = baseTree();
    t.depths = [{ nodeId: 'icc', courseCode: 'GC 1010', instructor: 'Dr Who', k: 4, u: 4, d: 4, method: 'faculty', leavesSignature: 'stale', setBy: 'x' }];
    mockFetch(t);
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    const row = (await screen.findByText('ICC profile building')).closest('[data-node]') as HTMLElement;
    expect(within(row).getByText('set by hand')).toBeTruthy();
    expect(within(row).getByText('suggested K2 U2 D3')).toBeTruthy();
    expect(within(row).getByText('Review: the skills under it changed')).toBeTruthy();
  });

  it('cluster mode shows structure controls; capture mode does not', async () => {
    mockFetch(baseTree());
    const { unmount } = render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
    await screen.findByText('Print production');
    expect(screen.getAllByRole('button', { name: 'Merge into…' }).length).toBeGreaterThan(0);
    unmount();
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    await screen.findByText('Print production');
    expect(screen.queryByRole('button', { name: 'Merge into…' })).toBeNull();
  });

  it('an API refusal shows its message', async () => {
    mockFetch(baseTree(), () => ({ ok: false, status: 409, json: { error: 'That parent was just retired.' } }));
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Put under ICC profile building' }));
    expect((await screen.findByRole('alert')).textContent).toContain('That parent was just retired.');
  });
});
