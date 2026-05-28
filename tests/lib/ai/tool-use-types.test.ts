import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { renderToolDescription, type ToolDefinition } from '@/lib/ai/tool-use-types';

const baseTool: ToolDefinition = {
  name: 'do_thing',
  description: 'Does a thing.',
  inputSchema: z.object({}),
  async execute() { return {}; },
};

describe('renderToolDescription', () => {
  it('returns the description verbatim when usagePolicy is absent', () => {
    expect(renderToolDescription(baseTool)).toBe('Does a thing.');
  });

  it('returns the description verbatim when usagePolicy is empty string', () => {
    expect(renderToolDescription({ ...baseTool, usagePolicy: '' })).toBe('Does a thing.');
  });

  it('appends usagePolicy under a Usage marker when present', () => {
    const out = renderToolDescription({
      ...baseTool,
      usagePolicy: 'Use sparingly; budget is 2 calls per turn.',
    });
    expect(out).toBe('Does a thing.\n\n**Usage:** Use sparingly; budget is 2 calls per turn.');
  });

  it('trims usagePolicy whitespace before checking emptiness', () => {
    expect(renderToolDescription({ ...baseTool, usagePolicy: '   \n  ' })).toBe('Does a thing.');
  });
});
