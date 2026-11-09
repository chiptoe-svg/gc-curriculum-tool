// @vitest-environment node
/** Part 2 Task 7: the pure compare step of the daily campus-alias check. */
import { describe, it, expect } from 'vitest';
import * as lib from '../../scripts/ai/campus-alias-lib.mjs';

describe('aliasMoved', () => {
  it('matches when the alias serves the pinned model (org prefix and case ignored)', () => {
    expect(lib.aliasMoved('zai-org/GLM-5.3', 'zai-org/GLM-5.3')).toBe(false);
    expect(lib.aliasMoved('Qwen/Qwen3.8-27B-FP8', 'qwen3.8-27b-fp8')).toBe(false);
  });
  it('reports a move when the alias serves another model', () => {
    expect(lib.aliasMoved('zai-org/GLM-5.4', 'zai-org/GLM-5.3')).toBe(true);
  });
  it('treats an unreadable probe as unknown, not moved', () => {
    expect(lib.aliasMoved(null, 'glm-5.3')).toBe(null);
  });
});

describe('decideIssue', () => {
  it('opens one issue when an alias moved and none is open', () => {
    expect(lib.decideIssue([{ alias: 'tiger', moved: true }], false)).toBe('open');
  });
  it('does nothing when an alias moved and the issue is already open', () => {
    expect(lib.decideIssue([{ alias: 'tiger', moved: true }], true)).toBe('none');
  });
  it('closes the issue when every alias matches again', () => {
    expect(lib.decideIssue([{ alias: 'tiger', moved: false }, { alias: 'cub', moved: false }], true)).toBe('close');
  });
  it('leaves things alone when a probe was unknown', () => {
    expect(lib.decideIssue([{ alias: 'tiger', moved: null }, { alias: 'cub', moved: false }], true)).toBe('none');
  });
});
