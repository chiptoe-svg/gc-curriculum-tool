import { describe, it, expect } from 'vitest';
import { MODEL_PRICING, MODEL_ROLES, ROLE_SETTINGS } from '@/lib/ai/models';

describe('model roles', () => {
  it('Judge, Converse and Write run gpt-6.1-sol at low effort', () => {
    for (const role of ['judge', 'converse', 'write'] as const) {
      expect(ROLE_SETTINGS[role]).toMatchObject({ model: 'gpt-6.1-sol', effort: 'low' });
    }
  });

  it('Extract runs gpt-5.4-mini with no effort setting', () => {
    expect(ROLE_SETTINGS.extract.model).toBe('gpt-5.4-mini');
    expect(ROLE_SETTINGS.extract.effort).toBeUndefined();
  });

  it('every role names a priced model, in a fixed order', () => {
    expect(MODEL_ROLES).toEqual(['judge', 'converse', 'write', 'extract']);
    for (const role of MODEL_ROLES) expect(MODEL_PRICING[ROLE_SETTINGS[role].model]).toBeDefined();
  });
});
