import { describe, it, expect } from 'vitest';
import { syllabusMaterials, hasSyllabusMaterial, syllabusReadinessLabel } from '@/lib/capture/material-display';

describe('syllabusMaterials / hasSyllabusMaterial', () => {
  it('counts flagged, unretired materials — set-aside ones included', () => {
    const mats = [
      { id: 'a', isSyllabus: true, retiredAt: null },
      { id: 'b', isSyllabus: true, retiredAt: '2026-10-01T00:00:00Z' },
      { id: 'c', isSyllabus: false, retiredAt: null },
      { id: 'd' },
    ];
    expect(syllabusMaterials(mats).map((m) => m.id)).toEqual(['a']);
    expect(hasSyllabusMaterial(mats)).toBe(true);
    expect(hasSyllabusMaterial([{ isSyllabus: false }])).toBe(false);
  });
});

describe('syllabusReadinessLabel', () => {
  it('says plainly when the syllabus is set aside', () => {
    expect(syllabusReadinessLabel({ ignored: true, indexingStatus: 'ready' }, true)).toBe('set aside — not sent to the AI');
  });
  it('a pending upload in the triage flow waits for Ingest', () => {
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'pending' }, true)).toBe('attached — will be read when you ingest');
  });
  it('otherwise uses the usual readability label', () => {
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'pending' }, false)).toBe('not indexed yet');
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'ready' }, true)).toBe('ready');
  });
});
