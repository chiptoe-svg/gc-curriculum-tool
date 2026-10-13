import { describe, it, expect } from 'vitest';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';
import { competencyEntryId } from '@/lib/domain/types';

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

  it('every sub-competency has unique id within its target (resolving refs)', () => {
    for (const t of CAREER_TARGETS) {
      const ids = t.subCompetencies.map(competencyEntryId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// Target batch 2026-10-06 (spec docs/superpowers/specs/2026-10-05-target-5-creative-ops-tech-draft.md, §4, §8, §12),
// updated 2026-10-12 for the P0b competency-catalog merges (migration 0057).
import { RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import { isSubCompetencyDefinition } from '@/lib/domain/types';

describe('seed-targets — 2026-10-06 target batch + 2026-10-12 P0b merges', () => {
  const byId = (id: string) => CAREER_TARGETS.find(t => t.id === id)!;

  it('target 5 has the nine owner-approved competencies in spec order, domain-grounding now a ref to domain-knowledge', () => {
    expect(byId('ai-workflow').subCompetencies.map(competencyEntryId)).toEqual([
      'brand-system-templating',
      'workflow-architecture',
      'digital-asset-management',
      'packaging-artwork-compliance',
      'systems-automation-integration',
      'color-management',
      'quality-frameworks',
      'ai-tool-evaluation',
      'domain-knowledge',
    ]);
    const entry = byId('ai-workflow').subCompetencies[8]!;
    expect(isSubCompetencyDefinition(entry)).toBe(false);
  });

  it('account-management has gc-production-literacy as a ref to domain-knowledge, in the same (last) position', () => {
    const entries = byId('account-management').subCompetencies;
    expect(entries.map(competencyEntryId).at(-1)).toBe('domain-knowledge');
    expect(isSubCompetencyDefinition(entries.at(-1)!)).toBe(false);
  });

  it('target 1 keeps project-management and domain-knowledge, loses timeline-management (folded into project-management), and names logistics', () => {
    const t = byId('production-operations');
    const ids = t.subCompetencies.map(competencyEntryId);
    expect(ids).toContain('project-management');
    expect(ids).toContain('domain-knowledge');
    expect(ids).not.toContain('timeline-management');
    expect(t.subCompetencies).toHaveLength(7);
    expect(t.shortDefinition).toMatch(/logistics/);
  });

  it('domain-knowledge and project-management are full definitions owned by production-operations', () => {
    const t = byId('production-operations');
    const domainKnowledge = t.subCompetencies.find(e => competencyEntryId(e) === 'domain-knowledge')!;
    const projectManagement = t.subCompetencies.find(e => competencyEntryId(e) === 'project-management')!;
    expect(isSubCompetencyDefinition(domainKnowledge)).toBe(true);
    expect(isSubCompetencyDefinition(projectManagement)).toBe(true);
  });

  it('retires prompt-design, change-management (2026-10-06) and gc-production-literacy, domain-grounding, timeline-management (2026-10-12 P0b merges), and keeps them out of the active lists', () => {
    expect(RETIRED_SUB_COMPETENCIES.map(r => [r.careerTargetId, r.id])).toEqual([
      ['ai-workflow', 'prompt-design'],
      ['ai-workflow', 'change-management'],
      ['account-management', 'gc-production-literacy'],
      ['ai-workflow', 'domain-grounding'],
      ['production-operations', 'timeline-management'],
    ]);
    const active = new Set(CAREER_TARGETS.flatMap(t => t.subCompetencies.map(competencyEntryId)));
    for (const r of RETIRED_SUB_COMPETENCIES) expect(active.has(r.id)).toBe(false);
  });

  it('the two 2026-10-12 merges carry mergedInto to the survivor', () => {
    const byRetiredId = new Map(RETIRED_SUB_COMPETENCIES.map(r => [r.id, r]));
    expect(byRetiredId.get('gc-production-literacy')?.mergedInto).toBe('domain-knowledge');
    expect(byRetiredId.get('domain-grounding')?.mergedInto).toBe('domain-knowledge');
    expect(byRetiredId.get('timeline-management')?.mergedInto).toBe('project-management');
    // the 2026-10-06 retirees were not part of a merge
    expect(byRetiredId.get('prompt-design')?.mergedInto).toBeUndefined();
    expect(byRetiredId.get('change-management')?.mergedInto).toBeUndefined();
  });

  it('every competency id used (resolving refs) has exactly one full definition across all targets', () => {
    const definitionCounts = new Map<string, number>();
    for (const t of CAREER_TARGETS) {
      for (const entry of t.subCompetencies) {
        if (isSubCompetencyDefinition(entry)) {
          definitionCounts.set(entry.id, (definitionCounts.get(entry.id) ?? 0) + 1);
        }
      }
    }
    for (const t of CAREER_TARGETS) {
      for (const entry of t.subCompetencies) {
        const id = competencyEntryId(entry);
        expect(definitionCounts.get(id)).toBe(1);
      }
    }
  });

  it('uses US spelling and carries no draft markup', () => {
    const text = JSON.stringify(CAREER_TARGETS);
    expect(text).not.toMatch(/colour|organisation|organise|behaviour/i);
    expect(text).not.toMatch(/\*/); // the draft's italics markers are review-only
  });
});
