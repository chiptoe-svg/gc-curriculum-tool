import { describe, it, expect } from 'vitest';
import { captureProfileJsonSchemaV2 } from '@/lib/ai/analyze/capture-scores';

// ---------------------------------------------------------------------------
// Strict-mode walker (same pattern as tests/ai/prereq-edge-seed-schema.test.ts)
// Invariant: for every object node with `properties`, every key in `properties`
// must appear in `required`.  Recurse into nested objects and array items.
// ---------------------------------------------------------------------------
function assertStrictMode(node: unknown, path = ''): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (
    (obj.type === 'object' || (Array.isArray(obj.type) && (obj.type as string[]).includes('object')))
    && obj.properties
    && typeof obj.properties === 'object'
  ) {
    const propKeys = Object.keys(obj.properties as object);
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of propKeys) {
      expect(required, `[${path || 'root'}] property "${key}" must appear in required`).toContain(key);
    }
    for (const [k, v] of Object.entries(obj.properties as object)) {
      assertStrictMode(v, `${path}.${k}`);
    }
  }
  if (obj.items) assertStrictMode(obj.items, `${path}[items]`);
  if (obj.anyOf && Array.isArray(obj.anyOf)) {
    for (const v of obj.anyOf) assertStrictMode(v, `${path}[anyOf]`);
  }
}

describe('captureProfileJsonSchemaV2 strict-mode discipline', () => {
  it('passes the walker (every property listed in required, recursively)', () => {
    assertStrictMode(captureProfileJsonSchemaV2);
  });

  it('has class_structure in required', () => {
    const required = (captureProfileJsonSchemaV2 as any).required as string[];
    expect(required).toContain('class_structure');
  });

  it('has major_projects in required', () => {
    const required = (captureProfileJsonSchemaV2 as any).required as string[];
    expect(required).toContain('major_projects');
  });

  it('class_structure is nullable (type: ["object", "null"])', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.type).toEqual(['object', 'null']);
  });

  it('major_projects is nullable (type: ["array", "null"])', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.type).toEqual(['array', 'null']);
  });

  it('class_structure sub-properties: topics is array, cadence/assessment are string', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.properties.topics.type).toBe('array');
    expect(cs.properties.cadence.type).toBe('string');
    expect(cs.properties.assessment.type).toBe('string');
  });

  it('class_structure.source is nullable enum', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.properties.source.type).toEqual(['string', 'null']);
  });

  it('major_projects items have required: [title, description, competencies, source, citations]', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.required).toContain('title');
    expect(mp.items.required).toContain('description');
    expect(mp.items.required).toContain('competencies');
    expect(mp.items.required).toContain('source');
    expect(mp.items.required).toContain('citations');
  });

  it('major_projects items include deliverables, what_it_develops, weight_pct, duration_weeks in required', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    const required: string[] = mp.items.required;
    expect(required).toContain('deliverables');
    expect(required).toContain('what_it_develops');
    expect(required).toContain('weight_pct');
    expect(required).toContain('duration_weeks');
  });

  it('deliverables is type array', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.deliverables.type).toBe('array');
  });

  it('what_it_develops is type string', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.what_it_develops.type).toBe('string');
  });

  it('weight_pct is nullable number', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.weight_pct.type).toEqual(['number', 'null']);
  });

  it('duration_weeks is nullable integer', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.duration_weeks.type).toEqual(['integer', 'null']);
  });
});
