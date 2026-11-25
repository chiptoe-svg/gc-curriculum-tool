import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrompt } from '@/lib/ai/prompts/load';

const words = (s: string) => s.split(/\s+/).filter((w) => w.length > 0).length;
const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

const old = readFileSync(join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');
const evidenceSection = old.slice(old.indexOf('# The Evidence Rule'), old.indexOf('# Disagreement triangulation')).trim();

describe('capture-interview-core prompt', () => {
  it('is 900-1,300 words', async () => {
    const n = words(await loadPrompt('capture-interview-core'));
    expect(n).toBeGreaterThanOrEqual(900);
    expect(n).toBeLessThanOrEqual(1300);
  });

  it('contains the Evidence Rule section verbatim from capture-chat-agent.md', async () => {
    expect(evidenceSection.length).toBeGreaterThan(200);
    expect(await loadPrompt('capture-interview-core')).toContain(evidenceSection);
  });

  it('states one question per turn and never ask again', async () => {
    const p = norm(await loadPrompt('capture-interview-core'));
    expect(p).toContain('one question per turn');
    expect(p).toContain('never ask again');
  });

  it('has no K/U/D level codes', async () => {
    expect(await loadPrompt('capture-interview-core')).not.toMatch(/\b[KUD][0-5]\b/);
  });

  it('includes neither the depth scale nor the Bloom module', async () => {
    const p = await loadPrompt('capture-interview-core');
    expect(p).not.toMatch(/^# Bloom language/m);
    expect(p).not.toContain('KUD Depth Scales');
  });

  it('describes the tools the model has', async () => {
    const p = await loadPrompt('capture-interview-core');
    for (const t of ['submit_turn', 'record_answer', 'search_materials', 'fetch_material_section', 'load_skill', 'note_for_lead']) {
      expect(p).toContain(t);
    }
  });

  it('says the Skip button marks unknown, and a typed skip is recorded unknown by the model', async () => {
    const p = norm(await loadPrompt('capture-interview-core'));
    expect(p).toContain('the skip button marks the slot unknown');
    expect(p).toMatch(/if the instructor types skip, move on or not sure, call `record_answer` with status `unknown` yourself, citing their message/);
  });

  it('records later-stage slots only when fully settled, never habits or incoming from a partial answer', async () => {
    const p = norm(await loadPrompt('capture-interview-core'));
    expect(p).toContain('only when the answer fully settles it');
    expect(p).toContain('never record `habits` or `incoming` from a partial answer');
  });

  it('allows a longer say for drafts, quoted objectives and the recap', async () => {
    const p = norm(await loadPrompt('capture-interview-core'));
    expect(p).toContain('except where the stage skill says to show a draft, quoted objectives or the recap');
  });
});

describe('Task 9b', () => {
  it('every turn asks the next question while the interview runs; answer_only only once it is complete', async () => {
    const p = norm(await loadPrompt('capture-interview-core'));
    expect(p).toContain('answer it in `say` and ask the next open question in the same turn');
    expect(p).toContain('only once the interview is complete');
    expect(p).not.toContain('if that is all the turn needs');
  });

  it('the recap is recorded only after it was shown', async () => {
    expect(norm(await loadPrompt('capture-interview-core'))).toContain('record `recap` only after the recap was shown');
  });
});
