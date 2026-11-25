import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrompt } from '@/lib/ai/prompts/load';

type Name = Parameters<typeof loadPrompt>[0];
const IN_SCOPE: Name[] = ['capture-chat-agent', 'capture-synthesis', 'objective-evidence-guide', 'synthesize-course-profile', 'wiki-update'];
const OUT_OF_SCOPE: Name[] = [
  'program-score-coverage', 'what-if-estimate', 'decompose-prereq-gap', 'prereq-edge-seed', 'kud-chat',
  'extract-course-kud', 'position-interview-agent', 'position-synthesis', 'position-rated-items', 'jd-extract',
  'capture-stress-test',
];
const depthHeading = (readFileSync(join(process.cwd(), 'lib/ai/prompts/shared/depth-scale.md'), 'utf8')
  .split('\n').find(l => l.startsWith('#')) ?? '').trim();

describe('Bloom language module includes', () => {
  it.each(IN_SCOPE)('%s includes the Bloom module', async name => {
    expect(await loadPrompt(name)).toMatch(/^# Bloom language/m);
  });
  it.each(OUT_OF_SCOPE)('%s does not', async name => {
    expect(await loadPrompt(name)).not.toMatch(/^# Bloom language/m);
  });
  it('keeps depth-scale in the prompts that already had it', async () => {
    expect(depthHeading.length).toBeGreaterThan(1);
    for (const n of ['capture-chat-agent', 'capture-synthesis'] as Name[]) expect(await loadPrompt(n)).toContain(depthHeading);
  });
});
