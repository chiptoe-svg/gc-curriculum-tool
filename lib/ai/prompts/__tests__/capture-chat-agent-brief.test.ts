import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const md = readFileSync(join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');
const section1b = md.slice(md.indexOf('## 1b. Downstream connections'), md.indexOf('## 2. Stated objectives'));
// Prose wraps at ~80 cols in the source file; normalize whitespace so
// assertions about multi-word phrases aren't sensitive to line wrapping.
const norm1b = section1b.replace(/\s+/g, ' ');
const atRestNorm = md.slice(md.indexOf('# What you have at rest'), md.indexOf('# Tools you can call')).replace(/\s+/g, ' ');

describe('capture-chat-agent prompt — course-context brief', () => {
  it('describes the brief at rest as never evidence', () => {
    const atRest = md.slice(md.indexOf('# What you have at rest'), md.indexOf('# Tools you can call'));
    expect(atRest).toContain('Neighboring courses');
    expect(atRest).toMatch(/never evidence/i);
  });
  it('replaces the stale "Course Outcome Profiles" bullet with the prerequisite-profiles block description', () => {
    expect(atRestNorm).toContain("Prerequisite courses' captured profiles");
    expect(atRestNorm).not.toContain('Course Outcome Profiles for captured prerequisite courses');
  });
  it('points Audit Area 1 Step 3 at the prerequisite-profiles block, with the uncaptured-probe nudge', () => {
    const step3 = md.slice(md.indexOf('**Step 3 — resolve arrival'), md.indexOf('**Step 4'));
    const norm = step3.replace(/\s+/g, ' ');
    expect(norm).toContain('A prerequisite course\'s captured profile, from the "Prerequisite courses\' captured profiles" block in your at-rest context.');
    expect(norm).toMatch(/not yet captured.*probe instead/i);
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
  it('keeps brief items out of citations[]', () => {
    expect(norm1b).toMatch(/do not put brief items in `citations\[\]`/i);
    expect(norm1b).toMatch(/citations are for this course's materials and the instructor's own words only/i);
  });
  it('skips the handoff probes when there is nothing to ground them in', () => {
    expect(norm1b).toMatch(/skip the handoff probes/i);
    expect(norm1b).toMatch(/no courses that build on this one/i);
    expect(norm1b).toMatch(/instructor doesn't know/i);
    expect(norm1b).toMatch(/counts toward the 2-probe cap/i);
  });
  it('marks the GC 4060/4070 flexo probe as an example', () => {
    expect(norm1b).toMatch(/e\.g\. \*"GC 4060 and GC 4070/);
    expect(norm1b).toContain('(use the courses in your brief)');
  });
});
