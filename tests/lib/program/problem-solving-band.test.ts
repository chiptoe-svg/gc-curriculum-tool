import { describe, it, expect } from 'vitest';
import { problemSolvingBand } from '@/lib/program/problem-solving-band';
import type { Area7Block } from '@/lib/ai/capture/area7-types';

const blk = (o: Partial<Area7Block>): Area7Block => ({ ...o });

describe('problemSolvingBand', () => {
  it('all absent → none ("no real")', () => {
    const r = problemSolvingBand(blk({
      generate_then_consolidate: 'absent', open_ended_problems: 'absent', revision_cycles: 'absent',
      structured_post_mortem: 'absent', abstraction_bridging: 'absent',
    }));
    expect(r.band).toBe('none');
    expect(r.label).toBe('no real');
    expect(r.score).toBe(0);
  });

  it('one partial → slight', () => {
    expect(problemSolvingBand(blk({ revision_cycles: 'partial' })).band).toBe('slight');
  });

  it('score 4–7 → moderate', () => {
    const r = problemSolvingBand(blk({ generate_then_consolidate: 'present', revision_cycles: 'present' }));
    expect(r.score).toBe(4);
    expect(r.band).toBe('moderate');
  });

  it('all present (10) → significant', () => {
    const r = problemSolvingBand(blk({
      generate_then_consolidate: 'present', open_ended_problems: 'present', revision_cycles: 'present',
      structured_post_mortem: 'present', abstraction_bridging: 'present',
    }));
    expect(r.score).toBe(10);
    expect(r.band).toBe('significant');
  });

  it('missing keys contribute 0 and do not throw', () => {
    expect(problemSolvingBand(blk({ open_ended_problems: 'present' })).score).toBe(2);
  });

  it('max_supporting_depth is NOT scored', () => {
    expect(problemSolvingBand(blk({ max_supporting_depth: 5 })).band).toBe('none');
  });
});
