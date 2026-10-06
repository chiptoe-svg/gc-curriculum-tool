import { describe, it, expect } from 'vitest';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

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

  it('CAREER_TARGETS can be used to find a target by id', () => {
    const target = CAREER_TARGETS.find(t => t.id === 'brand-strategy');
    expect(target?.name).toBe('Brand Strategy & Experience');
  });

  it('every sub-competency has unique id within its target', () => {
    for (const t of CAREER_TARGETS) {
      const ids = t.subCompetencies.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// Target batch 2026-10-06 (spec docs/superpowers/specs/2026-10-05-target-5-creative-ops-tech-draft.md, §4, §8, §12).
import { RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';

describe('seed-targets — 2026-10-06 target batch', () => {
  const byId = (id: string) => CAREER_TARGETS.find(t => t.id === id)!;

  it('target 5 has the nine owner-approved sub-competencies, in spec order', () => {
    expect(byId('ai-workflow').subCompetencies.map(s => s.id)).toEqual([
      'brand-system-templating',
      'workflow-architecture',
      'digital-asset-management',
      'packaging-artwork-compliance',
      'systems-automation-integration',
      'color-management',
      'quality-frameworks',
      'ai-tool-evaluation',
      'domain-grounding',
    ]);
  });

  it('target 1 gains project-management (8 competencies) and names logistics', () => {
    const t = byId('production-operations');
    expect(t.subCompetencies.map(s => s.id)).toContain('project-management');
    expect(t.subCompetencies).toHaveLength(8);
    expect(t.shortDefinition).toMatch(/logistics/);
  });

  it('retires prompt-design and change-management from target 5 and keeps them out of the active lists', () => {
    expect(RETIRED_SUB_COMPETENCIES.map(r => [r.careerTargetId, r.id])).toEqual([
      ['ai-workflow', 'prompt-design'],
      ['ai-workflow', 'change-management'],
    ]);
    const active = new Set(CAREER_TARGETS.flatMap(t => t.subCompetencies.map(s => s.id)));
    for (const r of RETIRED_SUB_COMPETENCIES) expect(active.has(r.id)).toBe(false);
  });

  it('sub-competency ids are unique across all targets (the DB primary key is global)', () => {
    const ids = CAREER_TARGETS.flatMap(t => t.subCompetencies.map(s => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses US spelling and carries no draft markup', () => {
    const text = JSON.stringify(CAREER_TARGETS);
    expect(text).not.toMatch(/colour|organisation|organise|behaviour/i);
    expect(text).not.toMatch(/\*/); // the draft's italics markers are review-only
  });
});
