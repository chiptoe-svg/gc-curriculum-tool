// 2026-10-07 A/B (owner-approved): repetition_penalty 1.3 on the Spark/vLLM page
// transcription produced runaways (3/36 to the 3000-token cap, fabricated text) and broke
// temp-0 determinism; 1.05 had none. The Spark (offload) branch uses 1.05; the local omlx
// fallback keeps 1.3 until it is tested.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('transcribeDocument repetition_penalty', () => {
  const src = readFileSync('lib/ai/local.ts', 'utf8');
  const offload = src.slice(src.indexOf('model: offload.model'), src.indexOf('// Local omlx:'));
  const local = src.slice(src.indexOf('// Local omlx:'), src.indexOf('offloadConcurrency:'));
  it('the Spark offload branch sends 1.05', () => {
    expect(offload).toMatch(/repetition_penalty: 1\.05,/);
  });
  it('the local omlx fallback keeps 1.3', () => {
    expect(local).toMatch(/repetition_penalty: 1\.3,/);
  });
});
