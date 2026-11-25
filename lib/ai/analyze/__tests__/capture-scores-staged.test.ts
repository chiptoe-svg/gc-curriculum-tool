import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildV2SynthesisUserMessage, type V2SynthesisContext } from '../capture-scores';
import { richContext } from './fixtures/rich-context';
import { buildLedger } from '@/lib/capture/staged/ledger';

const base: V2SynthesisContext = {
  chatContext: {
    course: {
      code: 'GC 9999', title: 'Fixture Course', description: 'A fixture.', prerequisites: 'GC 1010',
      learningObjectives: ['Do a thing'], majorProjects: ['Project A'], skillsRequired: ['Skill A'],
    },
    builderProfile: null,
    materials: [],
    priorCaptureProfile: null,
    prerequisiteCaptureProfiles: [],
  },
  sessionId: 's1',
  transcript: [],
};

describe('buildV2SynthesisUserMessage', () => {
  it('classic (no staged) message is byte-identical to the pre-staged output', () => {
    expect(buildV2SynthesisUserMessage(base)).toMatchSnapshot();
  });

  it('classic message with a realistic transcript matches the pre-change output (generated from a09dd9d4)', () => {
    const expected = readFileSync('lib/ai/analyze/__tests__/fixtures/rich-classic-message.txt', 'utf8');
    expect(buildV2SynthesisUserMessage(richContext)).toBe(expected);
  });

  const ledger = buildLedger(null, [
    { type: 'record', record: { slot: 'tests', status: 'filled_by_instructor', summary: 'Quizzes weekly', citations: [] } },
  ]);
  const staged = { map: { summary: 'MAPSUM', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [] }, ledger, leadNotes: ['Lead should know X'] };

  it('staged adds the record, map, gaps and lead notes sections', () => {
    const m = buildV2SynthesisUserMessage({ ...base, staged });
    expect(m).toContain('# Interview record (staged)');
    expect(m).toContain('Quizzes weekly');
    expect(m).toContain('# Evidence map (confirmed by the instructor)');
    expect(m).toContain('MAPSUM');
    expect(m).toContain('# Not reached or unknown');
    expect(m).toContain('# Notes for the department lead');
    expect(m).toContain('Lead should know X');
  });

  it('staged closing line names the stage 3 alternative; classic keeps Audit Area 7 only', () => {
    const staged0 = { map: null, ledger: buildLedger(null, []), leadNotes: [] };
    const m = buildV2SynthesisUserMessage({ ...base, staged: staged0 });
    expect(m).toContain('Emit productive_failure_conditions only if Audit Area 7 was probed or stage 3 (revision, transfer, threshold) slots were filled.');
    expect(m).not.toContain('Audit Area 7 was probed.');
    expect(buildV2SynthesisUserMessage(base)).toContain('Emit productive_failure_conditions only if Audit Area 7 was probed.');
  });

  it('lists not_reached slots as testimony gaps', () => {
    const m = buildV2SynthesisUserMessage({ ...base, staged: { ...staged, ledger: { ...ledger, finished: true } } });
    const gaps = m.split('# Not reached or unknown')[1]!;
    expect(gaps).toMatch(/not_reached/);
    expect(gaps).toMatch(/testimony gap/i);
  });
});

describe('capture-synthesis.md', () => {
  it('names the staged alternative for productive failure', () => {
    const md = readFileSync('lib/ai/prompts/capture-synthesis.md', 'utf8');
    expect(md).toContain('stage 3 (revision, transfer, threshold)');
  });
});
