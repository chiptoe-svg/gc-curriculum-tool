import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsClient } from '@/app/settings/SettingsClient';
import { DEFAULT_ROLES, FUNCTION_LABELS, FUNCTION_DESCRIPTIONS } from '@/lib/ai/function-settings';
import { ROLE_SETTINGS } from '@/lib/ai/models';

/** Pi plan Task 5: /settings shows the interview loop for capture-chat-agent only. */
const row = (functionId: 'capture-chat-agent' | 'wiki-update', loop: 'current' | 'pi' | null = null) => ({
  functionId, tier: DEFAULT_ROLES[functionId], defaultRole: DEFAULT_ROLES[functionId], customModel: null,
  resolvedModel: 'gpt-x', resolvedEffort: 'low', resolvedProvider: 'openai' as const, resolvedFallback: null, hasOverride: false, loop,
});
const props = {
  slug: 's', isAdmin: true,
  initialSettings: [row('capture-chat-agent'), row('wiki-update')],
  roles: ROLE_SETTINGS, defaults: DEFAULT_ROLES, labels: FUNCTION_LABELS, descriptions: FUNCTION_DESCRIPTIONS,
  functionIds: ['capture-chat-agent' as const, 'wiki-update' as const],
  costHistory: [{ day: '2026-11-09', spentCents: 0 }], capCents: 50000,
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [], stale: false, ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('interview loop on /settings', () => {
  it('shows one loop select, on the interview, defaulting to the current loop', () => {
    render(<SettingsClient {...props} />);
    const selects = screen.getAllByLabelText(/interview loop/i);
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe('current');
  });

  it('saves Pi through the settings route', async () => {
    render(<SettingsClient {...props} />);
    fireEvent.change(screen.getByLabelText(/interview loop/i), { target: { value: 'pi' } });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[1]?.body ?? '').includes('"loop":"pi"'))).toBe(true));
    const put = fetchMock.mock.calls.find(c => String(c[1]?.body ?? '').includes('"loop"'))!;
    expect(put[1].method).toBe('PUT');
    expect(JSON.parse(put[1].body)).toEqual({ functionId: 'capture-chat-agent', loop: 'pi' });
  });
});
