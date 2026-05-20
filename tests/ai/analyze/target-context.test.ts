import { describe, it, expect } from 'vitest';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import type { CareerTarget } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'Running the press floor day-to-day.',
  industryContexts: ['commercial print', 'packaging'],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: 'anchored to SOC code 51-5112.',
  socCode: '51-5112',
  subCompetencies: [
    { id: 'press-mechanics', name: 'Press Mechanics', knowDescriptor: 'press parts', understandDescriptor: 'wear patterns', doDescriptor: 'troubleshoot a jam' },
  ],
};

describe('buildTargetContext', () => {
  it('returns empty string when target is null', () => {
    expect(buildTargetContext(null)).toBe('');
  });
  it('includes name, definition, defensibility note, and each sub-competency', () => {
    const out = buildTargetContext(target);
    expect(out).toContain('Production Operations');
    expect(out).toContain('Running the press floor day-to-day.');
    expect(out).toContain('anchored to SOC code 51-5112.');
    expect(out).toContain('id=press-mechanics :: Press Mechanics');
    expect(out).toContain('Know: press parts');
    expect(out).toContain('Understand: wear patterns');
    expect(out).toContain('Do: troubleshoot a jam');
  });
});
