import { describe, it, expect } from 'vitest';
import { CAREER_TARGETS, getTargetById } from '@/lib/domain/seed-targets';

describe('seed-targets', () => {
  it('exposes all 5 career targets', () => {
    expect(CAREER_TARGETS).toHaveLength(5);
    const ids = CAREER_TARGETS.map(t => t.id);
    expect(ids).toEqual([
      'account-management',
      'brand-strategy',
      'production-operations',
      'creative-generalist',
      'ai-workflow',
    ]);
  });

  it('every target has at least 5 sub-competencies', () => {
    for (const t of CAREER_TARGETS) {
      expect(t.subCompetencies.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('getTargetById returns the target', () => {
    expect(getTargetById('brand-strategy')?.name).toBe('Brand Strategy');
  });

  it('every sub-competency has unique id within its target', () => {
    for (const t of CAREER_TARGETS) {
      const ids = t.subCompetencies.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
