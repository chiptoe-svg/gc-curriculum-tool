import { describe, it, expect } from 'vitest';
import { requireToolFirstStep } from '@/lib/ai/require-tool-first';

describe('requireToolFirstStep', () => {
  it('forces one of the named tools on the first step only', () => {
    const prepare = requireToolFirstStep(['search_materials', 'fetch_material_section']);
    expect(prepare).toBeDefined();
    expect(prepare!({ stepNumber: 0 })).toEqual({ toolChoice: 'required', activeTools: ['search_materials', 'fetch_material_section'] });
    expect(prepare!({ stepNumber: 1 })).toBeUndefined();
  });
  it('is undefined when nothing is required', () => {
    expect(requireToolFirstStep(undefined)).toBeUndefined();
    expect(requireToolFirstStep([])).toBeUndefined();
  });
});
