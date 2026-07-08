import { describe, it, expect } from 'vitest';
import { buildExploreTools } from '@/lib/ai/explore/agent-tools';

describe('buildExploreTools', () => {
  it('exposes the five explore tools with zod input schemas', () => {
    const tools = buildExploreTools('GC 3460', () => {});
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['compare_scenarios', 'estimate_impact', 'list_scenarios', 'neighbor_context', 'save_scenario']);
    for (const t of tools) {
      expect(typeof t.execute).toBe('function');
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.description).toBe('string');
    }
  });
  it('estimate_impact input schema requires a change string', () => {
    const t = buildExploreTools('GC 3460', () => {}).find(t => t.name === 'estimate_impact')!;
    expect(t.inputSchema.safeParse({ change: 'add a lab' }).success).toBe(true);
    expect(t.inputSchema.safeParse({}).success).toBe(false);
  });
});
