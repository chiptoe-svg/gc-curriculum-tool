import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { baseProfile, foundationalRow as foundational } from '@/tests/helpers/capture-profile-fixture';
import { baselineFoundationalCompetencies, captureProfileSchema } from '@/lib/ai/capture/schema';

const promptsDir = join(process.cwd(), 'lib/ai/prompts');
const read = (f: string) => readFileSync(join(promptsDir, f), 'utf8');

describe('written + spoken communication', () => {
  it('constant has six entries, both communication names, no plain Communication', () => {
    expect(baselineFoundationalCompetencies).toEqual([
      'Agency', 'Attention to Detail', 'Resilience', 'Curiosity',
      'Written Communication', 'Spoken Communication',
    ]);
    expect((baselineFoundationalCompetencies as readonly string[]).includes('Communication')).toBe(false);
  });

  it('capture chat system prompt lists both and says six', () => {
    const p = read('capture-chat-agent.md');
    expect(p).toContain('Written Communication');
    expect(p).toContain('Spoken Communication');
    expect(p).not.toMatch(/five baseline/i);
  });

  it('no prompt still lists "Curiosity, Communication"', () => {
    for (const f of readdirSync(promptsDir, { recursive: true }) as string[]) {
      // program-score-coverage.md (Task 4) keeps a generic example list, handles old rows as Partial.
      if (!f.endsWith('.md') || f === 'program-score-coverage.md') continue;
      expect(read(f), f).not.toContain('Curiosity, Communication');
    }
  });

  it('pre-2026-10-19 profile with a single Communication row still parses', () => {
    const r = captureProfileSchema.safeParse(baseProfile([foundational('Communication')]));
    expect(r.success).toBe(true);
  });

  it('new profile with Written + Spoken parses', () => {
    const r = captureProfileSchema.safeParse(
      baseProfile([foundational('Written Communication'), foundational('Spoken Communication')]),
    );
    expect(r.success).toBe(true);
  });
});
