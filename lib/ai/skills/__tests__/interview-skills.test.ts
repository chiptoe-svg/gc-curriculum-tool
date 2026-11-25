import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkill, SITUATIONAL_SKILLS } from '@/lib/ai/skills/load-skill';
import { STAGES } from '@/lib/capture/staged/stages';
import type { EvidenceMap } from '@/lib/capture/staged/evidence-map';

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
