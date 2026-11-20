import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SettingsClient } from '@/app/settings/SettingsClient';
import { DEFAULT_ROLES, FUNCTION_LABELS, FUNCTION_DESCRIPTIONS } from '@/lib/ai/function-settings';
import { ROLE_SETTINGS } from '@/lib/ai/models';
import type { Evidence } from '@/lib/settings/evidence-lookup';

const row = (functionId: 'capture-chat-agent' | 'wiki-update' | 'capture-scores', tier: 'converse' | 'write' | 'judge' | 'custom', customModel: string | null) => ({
  functionId, tier, defaultRole: DEFAULT_ROLES[functionId], customModel, resolvedModel: customModel ?? 'gpt-6.1-sol',
  resolvedEffort: 'medium', resolvedProvider: 'openai' as const, resolvedFallback: null, hasOverride: tier === 'custom',
});

const ev = (id: string, applies: string[], summary: string): Evidence => ({ id, title: id, date: '2026-11-19', applies, summary, body: '' });

const props = {
  slug: 's',
  initialSettings: [row('capture-chat-agent', 'custom', 'gpt-6.1-terra'), row('wiki-update', 'custom', 'gpt-4.1'), row('capture-scores', 'judge', null)],
  roles: ROLE_SETTINGS,
  defaults: DEFAULT_ROLES,
  labels: FUNCTION_LABELS,
  descriptions: FUNCTION_DESCRIPTIONS,
  functionIds: ['capture-chat-agent', 'wiki-update', 'capture-scores'] as const satisfies readonly string[],
  costHistory: [{ day: '2026-11-20', spentCents: 0 }],
  capCents: 50000,
  evidence: [
    ev('interview', ['capture-chat-agent'], 'Terra 90% vs Sol 87%'),
    ev('judge', ['role:judge'], 'Campus lost to Sol'),
    ev('rerank', ['search:rerank'], 'hit@1 41% to 59%'),
  ],
  search: { rerank: { override: null, effective: true, model: 'qwen3-rerank-4b' }, embedding: { model: 'qwen3-embedding-4b' } },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: ['gpt-4o', 'o3'], stale: false }) }));
});

function card(label: string): HTMLElement {
  return screen.getByRole('heading', { name: label }).closest('div.rounded-md') as HTMLElement;
}

describe('/settings evidence and search', () => {
  it('shows a function its own evidence with a link, a role default its role evidence, and says when nothing was measured', () => {
    render(<SettingsClient {...props} functionIds={[...props.functionIds]} isAdmin />);
    const interview = card(FUNCTION_LABELS['capture-chat-agent']);
    expect(interview.textContent).toContain('Terra 90% vs Sol 87%');
    expect(within(interview).getByRole('link', { name: /benchmark/ }).getAttribute('href')).toBe('/settings/benchmarks/interview?slug=s');
    expect(card(FUNCTION_LABELS['capture-scores']).textContent).toContain('Campus lost to Sol');
    expect(card(FUNCTION_LABELS['wiki-update']).textContent).toMatch(/not benchmarked for this function/i);
  });

  it('the picker offers OpenAI and campus groups, and keeps a pinned untested model', () => {
    render(<SettingsClient {...props} functionIds={[...props.functionIds]} isAdmin />);
    const select = within(card(FUNCTION_LABELS['wiki-update'])).getByRole('combobox') as HTMLSelectElement;
    const groups = [...select.querySelectorAll('optgroup')].map(g => g.label);
    expect(groups).toEqual(['Pinned now', 'OpenAI', 'Campus (free)']);
    expect(select.value).toBe('gpt-4.1');
    expect([...select.querySelectorAll('option')].map(o => o.value)).toContain('qwen3.8-27b-fp8');
  });

  it('shows the search settings with evidence; read-only for a non-admin', () => {
    render(<SettingsClient {...props} functionIds={[...props.functionIds]} isAdmin={false} />);
    const search = screen.getByRole('region', { name: 'Search' });
    expect(search.textContent).toContain('qwen3-rerank-4b');
    expect(search.textContent).toContain('qwen3-embedding-4b');
    expect(search.textContent).toContain('hit@1 41% to 59%');
    for (const name of ['On', 'Off', 'Server default']) expect(within(search).getByRole('button', { name })).toBeDisabled();
  });

  it('an admin can change the reranker', () => {
    render(<SettingsClient {...props} functionIds={[...props.functionIds]} isAdmin />);
    const search = screen.getByRole('region', { name: 'Search' });
    expect(within(search).getByRole('button', { name: 'Off' })).not.toBeDisabled();
  });
});
