import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsClient } from '@/app/settings/SettingsClient';
import { DEFAULT_ROLES, FUNCTION_LABELS, FUNCTION_DESCRIPTIONS } from '@/lib/ai/function-settings';
import { ROLE_SETTINGS } from '@/lib/ai/models';

/**
 * F1 (owner decision, 2026-10-07): AI model settings stay admin-only — the
 * server already enforces this (PUT/DELETE /api/settings/ai-models are
 * admin-kind in lib/auth/authorize.ts classify()). This pins that a
 * non-admin viewer sees the settings read-only with an explanatory note,
 * and the tier/reset controls are disabled, while an admin viewer sees the
 * normal interactive controls.
 */

const functionIds = ['capture-chat', 'wiki-update'] as const;
const baseProps = {
  slug: 's',
  initialSettings: [
    { functionId: 'capture-chat' as const, tier: 'converse' as const, defaultRole: 'converse' as const, customModel: null, resolvedModel: 'gpt-x', resolvedEffort: 'low' },
    { functionId: 'wiki-update' as const, tier: 'write' as const, defaultRole: 'write' as const, customModel: null, resolvedModel: 'gpt-x', resolvedEffort: 'low' },
  ],
  roles: ROLE_SETTINGS,
  defaults: DEFAULT_ROLES,
  labels: FUNCTION_LABELS,
  descriptions: FUNCTION_DESCRIPTIONS,
  functionIds: [...functionIds],
  costHistory: [{ day: '2026-10-07', spentCents: 0 }],
  capCents: 50000,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [], stale: false }) }));
});

describe('SettingsClient — admin-only AI model settings (F1)', () => {
  it('isAdmin=false: shows a read-only note and disables the tier/reset controls', () => {
    render(<SettingsClient {...baseProps} isAdmin={false} />);
    expect(screen.getByText(/only an admin can change ai model settings/i)).toBeTruthy();
    for (const roleLabel of [/^judge$/i, /^converse$/i, /^write$/i, /^extract$/i]) {
      for (const btn of screen.getAllByRole('button', { name: roleLabel })) expect(btn).toBeDisabled();
    }
  });

  it('isAdmin=true: no read-only note, tier controls are enabled', () => {
    render(<SettingsClient {...baseProps} isAdmin />);
    expect(screen.queryByText(/only an admin can change ai model settings/i)).toBeNull();
    const btn = screen.getAllByRole('button', { name: /^extract$/i })[0]!;
    expect(btn).not.toBeDisabled();
  });
});

describe('SettingsClient — roles', () => {
  it('lists each role with its purpose and groups functions under their role', () => {
    render(<SettingsClient {...baseProps} isAdmin />);
    for (const role of Object.values(ROLE_SETTINGS)) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${role.label}`) })).toBeTruthy();
      expect(screen.getAllByText(role.purpose).length).toBeGreaterThan(0);
    }
    const writeGroup = screen.getByRole('region', { name: /^Write/ });
    expect(writeGroup.textContent).toContain(FUNCTION_LABELS['wiki-update']);
    expect(writeGroup.textContent).not.toContain(FUNCTION_LABELS['capture-chat']);
  });
});
