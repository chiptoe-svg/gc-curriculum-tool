import { describe, it, expect } from 'vitest';
import { captureProfileJsonSchema, captureProfileJsonSchemaV2 } from '@/lib/ai/analyze/capture-scores';

function pf(schema: unknown): any {
  return (schema as any).properties.audit_notes.properties.productive_failure_conditions;
}

describe('productive_failure_conditions JSON schema', () => {
  it('v1 PF block is nullable (object|null) so the model can emit null', () => {
    expect(pf(captureProfileJsonSchema).type).toEqual(['object', 'null']);
  });

  it('v1 PF block declares structured_post_mortem_evidence in properties and required', () => {
    const block = pf(captureProfileJsonSchema);
    expect(block.properties.structured_post_mortem_evidence).toBeDefined();
    expect(block.properties.structured_post_mortem_evidence.type).toEqual(['array', 'null']);
    expect(block.required).toContain('structured_post_mortem_evidence');
  });

  it('v2 inherits both (it clones v1)', () => {
    const block = pf(captureProfileJsonSchemaV2);
    expect(block.type).toEqual(['object', 'null']);
    expect(block.required).toContain('structured_post_mortem_evidence');
    expect(block.properties.structured_post_mortem_evidence).toBeDefined(); // clone is deep
  });

  it('v1 PF block declares abstraction_bridging (enum) + evidence in properties and required', () => {
    const block = pf(captureProfileJsonSchema);
    expect(block.required).toContain('abstraction_bridging');
    expect(block.required).toContain('abstraction_bridging_evidence');
    expect(block.properties.abstraction_bridging.enum).toEqual(['present', 'partial', 'absent']);
    expect(block.properties.abstraction_bridging_evidence.type).toEqual(['array', 'null']);
  });

  it('v2 inherits abstraction_bridging (deep clone)', () => {
    const block = pf(captureProfileJsonSchemaV2);
    expect(block.required).toContain('abstraction_bridging');
    expect(block.properties.abstraction_bridging).toBeDefined();
    expect(block.required).toContain('abstraction_bridging_evidence');
  });
});
