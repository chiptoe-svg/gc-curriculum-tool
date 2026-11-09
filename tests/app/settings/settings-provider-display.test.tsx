import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsClient } from '@/app/settings/SettingsClient';
import { DEFAULT_ROLES, FUNCTION_LABELS, FUNCTION_DESCRIPTIONS } from '@/lib/ai/function-settings';
import { ROLE_SETTINGS } from '@/lib/ai/models';

/** Part 2 Task 2: /settings shows each function's provider and model, and the OpenAI fallback for campus routes. */
const props = {
  slug: 's',
  isAdmin: true,
  initialSettings: [
    { functionId: 'parse-profile-fields' as const, tier: 'extract' as const, defaultRole: 'extract' as const, customModel: null, resolvedModel: 'qwen3.8-27b-fp8', resolvedEffort: 'off', resolvedProvider: 'campus' as const, resolvedFallback: 'gpt-5.4-mini', hasOverride: false },
    { functionId: 'wiki-update' as const, tier: 'write' as const, defaultRole: 'write' as const, customModel: null, resolvedModel: 'gpt-x', resolvedEffort: 'low', resolvedProvider: 'openai' as const, resolvedFallback: null, hasOverride: false },
  ],
  roles: ROLE_SETTINGS, defaults: DEFAULT_ROLES, labels: FUNCTION_LABELS, descriptions: FUNCTION_DESCRIPTIONS,
  functionIds: ['parse-profile-fields' as const, 'wiki-update' as const],
  costHistory: [{ day: '2026-11-09', spentCents: 0 }], capCents: 50000,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [], stale: false }) }));
});

describe('provider on /settings', () => {
  it('shows a campus route with its fallback', () => {
    render(<SettingsClient {...props} />);
    expect(screen.getByText('campus · qwen3.8-27b-fp8 · thinking off · OpenAI gpt-5.4-mini if campus fails')).toBeTruthy();
  });
  it('shows an OpenAI route as OpenAI', () => {
    render(<SettingsClient {...props} />);
    expect(screen.getByText('OpenAI · gpt-x · low effort')).toBeTruthy();
  });
});

describe('reset on a campus route', () => {
  it('shows Reset when a function has a settings row, even if it names its default role', () => {
    const row = { ...props.initialSettings[0]!, resolvedModel: 'gpt-5.4-mini', resolvedEffort: undefined, resolvedProvider: 'openai' as const, resolvedFallback: null, hasOverride: true };
    render(<SettingsClient {...props} initialSettings={[row, props.initialSettings[1]!]} />);
    expect(screen.getAllByRole('button', { name: /reset/i }).length).toBeGreaterThan(0);
  });
});
