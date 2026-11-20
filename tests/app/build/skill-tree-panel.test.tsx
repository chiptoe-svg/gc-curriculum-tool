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

function mockFetch(tree: Tree, post?: () => { ok: boolean; status?: number; json: unknown }, getTree: Tree = tree) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      calls.push({ url, body: JSON.parse(init.body!) });
      const r = post?.() ?? { ok: true, json: { tree, notes: [] } };
      return { ok: r.ok, status: r.status ?? 200, json: async () => r.json };
    }
    return { ok: true, status: 200, json: async () => ({ tree: getTree, versions: versions(), suggestions: { b: [{ nodeId: 'icc', similarity: 0.8 }] } }) };
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

  it('hides a skill whose only placement for the course is an embedding suggestion', async () => {
    const t = baseTree();
    t.nodes.push(node('vend', 'Vendor selection', null));
    t.leaves.push({ ...leaf('b', 'vend', 'Calibrate a press'), source: 'embedding' as const, status: 'proposed' as const });
    mockFetch(t);
    render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
    await screen.findByText('Agency');
    expect(screen.queryByText('Vendor selection')).toBeNull();
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

  it('keeps a half-filled form open and typed when a write fails', async () => {
    mockFetch(baseTree(), () => ({ ok: false, status: 409, json: { error: 'Nope.' } }));
    render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
    const row = (await screen.findByText('ICC profile building')).closest('[data-node]') as HTMLElement;
    fireEvent.click(within(row).getAllByRole('button', { name: 'Rename' })[0]!);
    const input = within(row).getByLabelText('New name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Color profiles' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save name' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('New name') as HTMLInputElement).value).toBe('Color profiles');
  });

  describe('New parent skill', () => {
    const made = (): Tree => { const t = baseTree(); t.nodes.push(node('n1', 'Press calibration', 'r')); return t; };
    async function fill() {
      render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      fireEvent.click(await screen.findByRole('button', { name: 'New parent skill…' }));
      fireEvent.change(screen.getByLabelText('New skill name'), { target: { value: 'Press calibration' } });
      fireEvent.click(screen.getByRole('button', { name: 'Print production' }));
    }

    it('retrying after a failed place sends place only, not a second create', async () => {
      let n = 0;
      const calls = mockFetch(made(), () => {
        n++;
        return n === 2 ? { ok: false, status: 409, json: { error: 'Place failed.' } } : { ok: true, json: { tree: made(), notes: [] } };
      }, baseTree());
      await fill();
      await screen.findByText('Place failed.');
      fireEvent.click(screen.getByRole('button', { name: 'Print production' }));
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(calls.map((c) => c.body!.action)).toEqual(['create', 'place', 'place']);
      expect(calls[2]!.body).toMatchObject({ skillRef: 'b', nodeId: 'n1' });
    });

    it('says so when the new skill cannot be found after creating it', async () => {
      mockFetch(baseTree());
      await fill();
      expect((await screen.findByRole('alert')).textContent).toMatch(/could not be found/);
    });
  });

  describe('building the tree under existing placements', () => {
    const masterTree = (status: 'confirmed' | 'proposed' = 'confirmed'): Tree => ({
      nodes: [node('m', 'Color management', null, { competencyId: 'comp' }), node('icc', 'ICC profiles', 'm'), node('free', 'Free skill', null)],
      leaves: [{ ...leaf('a', 'm', 'Build a profile'), status, source: status === 'proposed' ? ('ai' as const) : ('faculty' as const) }],
      depths: [],
    });
    const leafRow = async (text: string | RegExp) => (await screen.findByText(text)).closest('li') as HTMLElement;

    it('Move to… on a placed skill sends move with from and to', async () => {
      const calls = mockFetch(masterTree());
      render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      const row = await leafRow('Build a profile');
      fireEvent.click(within(row).getByRole('button', { name: 'Move to…' }));
      fireEvent.change(within(row).getByLabelText('Move to'), { target: { value: 'icc' } });
      fireEvent.click(within(row).getByRole('button', { name: 'Color management › ICC profiles' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({ action: 'move', courseCode: 'GC 1010', skillRef: 'a', from: 'm', to: 'icc' });
    });

    it('a proposed placement shows suggested, Confirm and Not here', async () => {
      const calls = mockFetch(masterTree('proposed'));
      render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      const row = await leafRow('Build a profile');
      expect(within(row).getByText('suggested')).toBeTruthy();
      fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({ action: 'confirm', courseCode: 'GC 1010', skillRef: 'a', nodeId: 'm' });
      fireEvent.click(within(row).getByRole('button', { name: 'Not here' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]!.body).toMatchObject({ action: 'reject', courseCode: 'GC 1010', skillRef: 'a', nodeId: 'm' });
    });

    it('a confirmed placement has Move to… but no Confirm or Not here, and no suggested label', async () => {
      mockFetch(masterTree());
      render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      const row = await leafRow('Build a profile');
      expect(within(row).getByRole('button', { name: 'Move to…' })).toBeTruthy();
      expect(within(row).queryByRole('button', { name: 'Confirm' })).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Not here' })).toBeNull();
      expect(within(row).queryByText('suggested')).toBeNull();
    });

    it.each(['capture', 'cluster'] as const)('Add a parent skill under this works on a master row (%s mode)', async (mode) => {
      const calls = mockFetch(masterTree());
      if (mode === 'capture') render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      else render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
      const row = (await screen.findByText('Color management')).closest('[data-node]') as HTMLElement;
      fireEvent.click(within(row).getAllByRole('button', { name: 'Add a parent skill under this' })[0]!);
      fireEvent.change(within(row).getAllByLabelText('Name of the new skill')[0]!, { target: { value: 'Profile building' } });
      fireEvent.click(within(row).getAllByRole('button', { name: 'Add skill' })[0]!);
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({ action: 'create', name: 'Profile building', parentId: 'm' });
    });

    it('master rows hide the tools the server refuses; other rows keep them', async () => {
      const t = masterTree();
      t.leaves.push(leaf('z', 'free', 'Another skill'));
      mockFetch(t);
      render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
      const master = (await screen.findByText('Color management')).closest('[data-node="m"]') as HTMLElement;
      for (const hidden of ['Rename', 'Move under…', 'Merge into…', 'Split…', 'Set weight']) expect(within(master).queryByRole('button', { name: hidden })).toBeNull();
      expect(within(master).queryByLabelText('Weight for Color management')).toBeNull();
      const plain = (await screen.findByText('Free skill')).closest('[data-node="free"]') as HTMLElement;
      for (const shown of ['Rename', 'Move under…', 'Merge into…', 'Split…', 'Set weight']) expect(within(plain).getAllByRole('button', { name: shown }).length).toBeGreaterThan(0);
    });

    it('cluster mode shows the course code on each placed skill', async () => {
      mockFetch(masterTree());
      render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
      expect(await screen.findByText('GC 1010 — Build a profile')).toBeTruthy();
    });

    it('capture mode shows the bare statement', async () => {
      mockFetch(masterTree());
      render(<SkillTreePanel courseCode="GC 1010" mode="capture" authorName="Dr Who" />);
      expect(await screen.findByText('Build a profile')).toBeTruthy();
      expect(screen.queryByText(/GC 1010 —/)).toBeNull();
    });

    it('the split checklist names the course of each skill', async () => {
      const t: Tree = { nodes: [node('r', 'Print production', null), node('icc', 'ICC profiles', 'r')], leaves: [leaf('a', 'icc', 'Build a profile')], depths: [] };
      mockFetch(t);
      render(<SkillTreePanel courseCode={null} mode="cluster" courseCodes={['GC 1010']} authorName="Dr Who" />);
      const row = (await screen.findByText('ICC profiles')).closest('[data-node="icc"]') as HTMLElement;
      fireEvent.click(within(row).getAllByRole('button', { name: 'Split…' })[0]!);
      expect(within(row).getAllByLabelText(/GC 1010 — Build a profile/).length).toBeGreaterThan(0);
    });
  });
});
