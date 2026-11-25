import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkill, parseSkillText, SITUATIONAL_SKILLS } from '@/lib/ai/skills/load-skill';
import { STAGES } from '@/lib/capture/staged/stages';
import { EvidenceMapSchema, type EvidenceMap } from '@/lib/capture/staged/evidence-map';

const words = (s: string) => s.split(/\s+/).filter((w) => w.length > 0).length;
const LEVEL_CODE = /\b[KUD][0-5]\b/;
const BLOOM_BLOCK = /<!-- bloom -->([\s\S]*?)<!-- \/bloom -->/g;

const STAGE_SKILLS = STAGES.map((s) => s.skill);
const ALL_SKILLS = [...STAGE_SKILLS, 'interview-pre-read', ...SITUATIONAL_SKILLS];

// A map with an unevidenced objective so stage 6 shows its `objectives` slot.
const MAP: EvidenceMap = {
  summary: '', graded_work: [], tests: [], competencies: [], assumed_skills: [],
  objectives: [{ text: 'x', status: 'not_found', graded_work: [] }],
  conflicts: [], unreadable: [],
};

const rawFile = (name: string) =>
  readFileSync(join(process.cwd(), 'lib/ai/skills/interview', name, 'SKILL.md'), 'utf8');

describe('interview skills', () => {
  it('lists the three situational skills', () => {
    expect([...SITUATIONAL_SKILLS]).toEqual(['materials-vs-testimony', 'critique-or-oral-assessment', 'first-time-instructor']);
  });

  it.each(ALL_SKILLS)('%s loads with valid Agent Skills frontmatter', (name) => {
    const s = loadSkill(name);
    expect(s.name).toBe(name);
    expect(s.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(s.name.length).toBeLessThanOrEqual(64);
    expect(s.description.length).toBeGreaterThanOrEqual(1);
    expect(s.description.length).toBeLessThanOrEqual(1024);
    expect(s.body.trim().length).toBeGreaterThan(0);
    expect(s.body).not.toMatch(/^---/);
  });

  it.each(STAGES.map((s) => [s.skill, s] as const))('%s names every slot id of its stage', (_name, stage) => {
    const body = loadSkill(stage.skill).body;
    const slots = stage.slots(MAP, ['ANCHOR_A', 'ANCHOR_B']);
    for (const slot of slots) {
      if (slot.startsWith('graded_on:')) {
        expect(body).toContain('`graded_on:');
      } else {
        expect(body).toContain('`' + slot + '`');
      }
    }
  });

  it.each(STAGE_SKILLS)('%s is at most 450 words', (name) => {
    expect(words(loadSkill(name).body)).toBeLessThanOrEqual(450);
  });

  it.each(ALL_SKILLS)('%s has no K/U/D level codes', (name) => {
    expect(rawFile(name)).not.toMatch(LEVEL_CODE);
  });

  it('puts Bloom wording only in stage-2-evidence and stage-6-objectives, 60-100 words in all', () => {
    let total = 0;
    for (const name of ALL_SKILLS) {
      const blocks = [...rawFile(name).matchAll(BLOOM_BLOCK)];
      if (name === 'stage-2-evidence' || name === 'stage-6-objectives') {
        expect(blocks.length, name).toBeGreaterThan(0);
        for (const b of blocks) total += words(b[1] ?? '');
      } else {
        expect(blocks.length, name).toBe(0);
        expect(rawFile(name), name).not.toContain('<!-- bloom');
      }
    }
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('bloom: false strips the Bloom block; the default keeps its text', () => {
    for (const name of ['stage-2-evidence', 'stage-6-objectives']) {
      const inner = [...rawFile(name).matchAll(BLOOM_BLOCK)].map((m) => (m[1] ?? '').trim());
      const withBloom = loadSkill(name).body;
      const without = loadSkill(name, { bloom: false }).body;
      for (const text of inner) {
        expect(withBloom).toContain(text);
        expect(without).not.toContain(text);
      }
      expect(without).not.toContain('<!-- bloom');
      expect(withBloom).not.toContain('<!-- bloom');
    }
  });

  it('memoizes', () => {
    expect(loadSkill('stage-1-course')).toBe(loadSkill('stage-1-course'));
  });

  it('rejects names that are not valid skill names', () => {
    expect(() => loadSkill('../stage-1-course')).toThrow();
    expect(() => loadSkill('Stage-1')).toThrow();
    expect(() => loadSkill('no-such-skill')).toThrow();
  });

  it('stage 1 tells the model to record anchors one per line', () => {
    expect(loadSkill('stage-1-course').body).toMatch(/one per line/i);
  });

  it('stage 2 uses the anchor lines verbatim in graded_on slot ids', () => {
    expect(loadSkill('stage-2-evidence').body).toMatch(/verbatim/i);
  });
});

/** The text of a `## ...` section whose heading contains `marker`, up to the next `## `. */
function section(body: string, marker: string): string {
  const start = body.indexOf('\n## ' + marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('interview skills: fix round 1', () => {
  it('stage 2 tests question is open: no question line offers "or" choices, and test formats are not asked', () => {
    const tests = section(loadSkill('stage-2-evidence').body, '`tests`');
    expect(tests).toContain('What do those tests ask students to do?');
    for (const line of tests.split('\n')) {
      if (line.includes('?')) expect(line, line).not.toMatch(/\bor\b/);
    }
  });

  it('stage 2 conditions asks open and illustrates the range only as a follow-up', () => {
    const cond = section(loadSkill('stage-2-evidence').body, '`conditions`');
    expect(cond).toMatch(/only as (your|the) follow-up/i);
  });

  it('the pre-read names every EvidenceMap field', () => {
    const body = loadSkill('interview-pre-read').body;
    const fields = new Set<string>();
    for (const [key, schema] of Object.entries(EvidenceMapSchema.shape)) {
      fields.add(key);
      const def = schema as unknown as { element?: { shape?: Record<string, unknown> } };
      for (const sub of Object.keys(def.element?.shape ?? {})) fields.add(sub);
    }
    expect(fields.size).toBeGreaterThan(15);
    for (const f of fields) expect(body, f).toContain('`' + f + '`');
    expect(body).toMatch(/only `conflicts` name chunk ids/i);
  });

  it('no quoted instructor-facing question says "slot"', () => {
    for (const name of ALL_SKILLS) {
      for (const line of rawFile(name).split('\n')) {
        if (line.startsWith('>')) expect(line, name).not.toMatch(/slot/i);
      }
    }
  });

  it('stage 1 asks only which two pieces carry the course, with the right correction window', () => {
    const body = loadSkill('stage-1-course').body;
    expect(body).toContain('> "Which two pieces of graded work carry the course?"');
    expect(body).toMatch(/until any `graded_on` question is asked or recorded/);
    expect(body).toContain('If an earlier answer already settled one');
  });

  it('stage 5 uses one phrase for a habit with nothing behind it', () => {
    const body = loadSkill('stage-5-habits').body;
    expect(body).toContain('nothing yet');
    expect(body).not.toMatch(/no evidence/i);
  });

  it('stage 4 says the card is the one allowed fixed-choice format', () => {
    expect(loadSkill('stage-4-incoming').body).toMatch(/only fixed-choice/i);
  });

  it('stage 6 recap ends by naming topics still unknown or not reached, within the 8 lines', () => {
    expect(loadSkill('stage-6-objectives').body).toMatch(/within the 8 lines, end by naming the topics still unknown or not reached/i);
  });

  it('critique skill notes speaking for the stage 5 draft and labels choices as listen-for', () => {
    const body = loadSkill('critique-or-oral-assessment').body;
    expect(body).toMatch(/stage 5 draft/i);
    expect(body).not.toMatch(/record it there/i);
    expect(body).toMatch(/listen for/i);
  });

  it('first-time instructor skill asks what they will use', () => {
    expect(loadSkill('first-time-instructor').body).toMatch(/ask what they will use/i);
  });

  it('the loader rejects block-scalar (multi-line) descriptions', () => {
    const ok = '---\nname: x-y\ndescription: Does a thing. Use when needed.\n---\nBody\n';
    expect(parseSkillText('x-y', ok).description).toBe('Does a thing. Use when needed.');
    for (const ind of ['>', '|', '>-', '|-']) {
      const bad = `---\nname: x-y\ndescription: ${ind}\n  Does a thing.\n---\nBody\n`;
      expect(() => parseSkillText('x-y', bad), ind).toThrow(/multi-line/i);
    }
  });
});
