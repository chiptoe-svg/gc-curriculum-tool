import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const md = readFileSync(join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');
const section1b = md.slice(md.indexOf('## 1b. Downstream connections'), md.indexOf('## 2. Stated objectives'));

describe('capture-chat-agent prompt — course-context brief', () => {
  it('describes the brief at rest as never evidence', () => {
    const atRest = md.slice(md.indexOf('# What you have at rest'), md.indexOf('# Tools you can call'));
    expect(atRest).toContain('Neighboring courses');
    expect(atRest).toMatch(/never evidence/i);
  });
  it('caps handoff probes at 2 and forbids inventing expectations', () => {
    expect(section1b).toMatch(/at most 2 handoff probes per session/);
    expect(section1b).toContain('not yet captured');
    expect(section1b).toContain('audit_notes.downstream_connections');
    expect(section1b).not.toMatch(/at most one downstream probe/i);
  });
  it('asks open first and nudges on projects', () => {
    expect(section1b).toMatch(/open first/i);
    expect(section1b).toMatch(/duplicat/i);
    expect(section1b).toMatch(/progression/i);
  });
});
