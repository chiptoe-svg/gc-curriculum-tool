import { describe, it, expect } from 'vitest';
import { reconcileProposalsSchema, reconcileProposalsJsonSchema } from '@/lib/ai/schemas';

describe('reconcileProposalsSchema', () => {
  it('parses a valid proposals payload', () => {
    const r = reconcileProposalsSchema.parse({
      proposals: [
        { index: 0, action: 'modify', revised: { statement: 'Sharper outcome', k: null, u: null, d: 3 }, rationale: 'faculty lowered Do' },
        { index: 2, action: 'remove', revised: null, rationale: 'not actually taught' },
        { index: null, action: 'add', revised: { statement: 'New outcome', k: null, u: null, d: 2 }, rationale: 'added by faculty' },
      ],
    });
    expect(r.proposals).toHaveLength(3);
  });
  it('rejects an unknown action', () => {
    expect(() => reconcileProposalsSchema.parse({ proposals: [{ index: 0, action: 'nuke', revised: null, rationale: 'x' }] })).toThrow();
  });
});

describe('reconcileProposalsJsonSchema (OpenAI strict)', () => {
  it('lists every property in required, recursively', () => {
    const check = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object' || (Array.isArray(n.type) && (n.type as string[]).includes('object'))) {
        const props = Object.keys((n.properties as Record<string, unknown>) ?? {});
        const req = (n.required as string[]) ?? [];
        expect([...req].sort()).toEqual([...props].sort());
        for (const v of Object.values((n.properties as Record<string, unknown>) ?? {})) check(v);
      }
      if (n.items) check(n.items);
    };
    check(reconcileProposalsJsonSchema);
  });
});
