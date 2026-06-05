import { describe, it, expect } from 'vitest';
import { coveredIncludesProblemSolving } from '@/app/capture/[code]/CaptureChatPanel';

describe('coveredIncludesProblemSolving', () => {
  it('true when a topic mentions reflection', () => {
    expect(coveredIncludesProblemSolving(['outcomes', 'reflection'])).toBe(true);
  });
  it('true (case-insensitive) for "Productive Failure"', () => {
    expect(coveredIncludesProblemSolving(['Productive Failure'])).toBe(true);
  });
  it('true for "problem-solving"', () => {
    expect(coveredIncludesProblemSolving(['problem-solving conditions'])).toBe(true);
  });
  it('false when no topic relates to problem-solving', () => {
    expect(coveredIncludesProblemSolving(['outcomes', 'projects', 'rubrics', 'prereqs'])).toBe(false);
  });
  it('false for an empty list', () => {
    expect(coveredIncludesProblemSolving([])).toBe(false);
  });
});
