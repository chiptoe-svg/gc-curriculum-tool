import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsClient } from '@/app/settings/SettingsClient';
import { DEFAULT_TIERS, FUNCTION_LABELS, FUNCTION_DESCRIPTIONS, TIER_TO_MODEL } from '@/lib/ai/function-settings';

/**
 * F1 (owner decision, 2026-10-07): AI model settings stay admin-only — the
 * server already enforces this (PUT/DELETE /api/settings/ai-models are
 * admin-kind in lib/auth/authorize.ts classify()). This pins that a
 * non-admin viewer sees the settings read-only with an explanatory note,
 * and the tier/reset controls are disabled, while an admin viewer sees the
 * normal interactive controls.
 */

const functionIds = ['capture-chat'] as const;
const baseProps = {
  slug: 's',
  initialSettings: [{ functionId: 'capture-chat' as const, tier: 'default' as const, defaultTier: 'default' as const, customModel: null, resolvedModel: 'gpt-x' }],
  tierToModel: TIER_TO_MODEL,
  defaults: DEFAULT_TIERS,
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
    for (const tierLabel of [/^light$/i, /^default$/i, /^heavy$/i]) {
      const btn = screen.getByRole('button', { name: tierLabel });
      expect(btn).toBeDisabled();
    }
  });

  it('isAdmin=true: no read-only note, tier controls are enabled', () => {
    render(<SettingsClient {...baseProps} isAdmin />);
    expect(screen.queryByText(/only an admin can change ai model settings/i)).toBeNull();
    const btn = screen.getByRole('button', { name: /^light$/i });
    expect(btn).not.toBeDisabled();
  });
});
