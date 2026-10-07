// Owner, 2026-10-07: most courses won't have a Google Sheet row, so the
// "Generating the Course Outcome Profile" steps must not mention it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('generating-profile steps', () => {
  it('step 1 names the syllabus and materials, not the Google Sheet', () => {
    const src = readFileSync('app/capture/[code]/CaptureClient.tsx', 'utf8');
    const step1 = src.split('1 · Gathering the evidence.')[1]!.split('</li>')[0]!;
    expect(step1).not.toMatch(/sheet/i);
    expect(step1).toMatch(/syllabus/i);
  });
});
