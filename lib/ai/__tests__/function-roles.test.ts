/** Functions map to roles; saved rows (including old tier names) resolve to a model and effort. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { AI_FUNCTION_IDS, DEFAULT_ROLES, resolveSetting } from '@/lib/ai/function-settings';

const SOL = { model: 'gpt-6.1-sol', effort: 'low' };
const MINI = { model: 'gpt-5.4-mini', effort: undefined };

// Spec: docs/superpowers/specs/2026-10-27-model-roles-design.md, "Function assignments".
const SPEC_ROLES = {
  judge: ['program-score-coverage', 'capture-scores', 'capture-stress-test', 'intended-skills-extract', 'prereq-edge-seed', 'bundle-map-onet', 'extract-course-kud'],
  converse: ['capture-chat-agent', 'capture-chat', 'curriculum-chat', 'explore-agent', 'position-interview-agent', 'kud-chat'],
  write: ['wiki-update', 'objective-evidence-guide', 'bundle-card-draft', 'position-synthesis', 'synthesize-target', 'reconcile-feedback', 'explore-local-delta', 'position-rated-items'],
  extract: ['material-digest', 'chunk-contextualize', 'material-classify', 'materials-analysis', 'ingestion-checkin', 'jd-extract', 'parse-profile-fields', 'decompose-prereq-gap'],
};

// What each function ran before roles (old light tier → gpt-5.4-mini, everything else → Sol low).
const OLD_LIGHT = ['materials-analysis', 'decompose-prereq-gap', 'material-digest', 'chunk-contextualize', 'ingestion-checkin', 'jd-extract', 'material-classify'];

describe('function roles', () => {
  it('every function has the role the spec assigns', () => {
    const byRole: Record<string, string[]> = { judge: [], converse: [], write: [], extract: [] };
    for (const id of AI_FUNCTION_IDS) byRole[DEFAULT_ROLES[id]]!.push(id);
    for (const role of Object.keys(SPEC_ROLES) as Array<keyof typeof SPEC_ROLES>) {
      expect(byRole[role]!.sort()).toEqual([...SPEC_ROLES[role]].sort());
    }
    expect(Object.keys(DEFAULT_ROLES).sort()).toEqual([...AI_FUNCTION_IDS].sort());
  });

  it('compiled defaults keep today\'s model and effort, except parse-profile-fields and Converse (medium, owner 2026-10-27)', () => {
    for (const id of AI_FUNCTION_IDS) {
      const expected = OLD_LIGHT.includes(id) || id === 'parse-profile-fields' ? MINI
        : SPEC_ROLES.converse.includes(id) ? { ...SOL, effort: 'medium' } : SOL;
      const { model, effort } = resolveSetting(id, null, null);
      expect({ id, model, effort }).toEqual({ id, ...expected });
    }
  });

  it('an old default row on an Extract function keeps Sol', () => {
    expect(resolveSetting('material-digest', 'default', null)).toMatchObject(SOL);
  });

  it('old light maps to Extract', () => {
    expect(resolveSetting('wiki-update', 'light', null)).toMatchObject({ role: 'extract', ...MINI });
  });

  it('old heavy maps to the function\'s role', () => {
    expect(resolveSetting('wiki-update', 'heavy', null)).toEqual({ role: 'write', ...SOL });
  });

  it('an unknown stored value falls back to the function\'s role', () => {
    expect(resolveSetting('wiki-update', 'bogus', null)).toMatchObject({ role: 'write', ...SOL });
  });

  it('a custom model uses that model\'s own default effort (none for gpt-5.4)', () => {
    expect(resolveSetting('jd-extract', 'custom', 'gpt-5.4')).toEqual({ role: 'custom', model: 'gpt-5.4', effort: undefined });
  });

  it('a role row resolves to that role', () => {
    expect(resolveSetting('jd-extract', 'judge', null)).toEqual({ role: 'judge', ...SOL });
  });
});
