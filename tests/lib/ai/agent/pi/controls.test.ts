// @vitest-environment node
/** Pi plan Task 1: one copy of each interview control, shared by the current loop and the Pi loop. */
import { describe, it, expect } from 'vitest';
import * as live from '@/lib/ai/agent/interview-controls';
import * as pi from '@/lib/ai/agent/pi/controls';

describe('Pi controls', () => {
  it('are the live controls, not a copy', () => {
    expect(pi.needsMaterialSearch).toBe(live.needsMaterialSearch);
    expect(pi.checkCitations).toBe(live.checkCitations);
    expect(pi.repairCitations).toBe(live.repairCitations);
    expect(pi.keepValidCitations).toBe(live.keepValidCitations);
  });

  it('count list_materials as a material tool', () => {
    expect([...pi.MATERIAL_TOOLS].sort()).toEqual(['fetch_material_section', 'list_materials', 'search_materials']);
  });

  it('allow two citation send-backs and no search send-back (search is forced first)', () => {
    expect(pi.MAX_CITATION_RETRIES).toBe(2);
    expect(pi.MAX_SEARCH_RETRIES).toBe(0);
  });

  it('tell the model each citation problem to fix', () => {
    expect(pi.citationFollowUp(['chunkId x was not retrieved', 'messageId y is not an instructor message']))
      .toBe('Your answer has citation problems:\n- chunkId x was not retrieved\n- messageId y is not an instructor message\nFix them and give your answer again.');
  });
});
