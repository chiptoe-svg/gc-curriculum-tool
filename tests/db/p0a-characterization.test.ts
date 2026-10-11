// @vitest-environment node
// P0a characterization (scratch DB only; run ALONE, never in the same vitest
// invocation as other DB tests). Capture: P0A_CAPTURE=1 writes the golden.
// Compare: every probe must deep-equal the golden.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canon, collectProbes } from './p0a/probes';
import { isScratchDb } from './p0a/scratch-guard';

const GOLDEN = process.env.P0A_GOLDEN;
const CAPTURE = process.env.P0A_CAPTURE === '1';

describe.skipIf(!isScratchDb() || !GOLDEN)('P0a characterization: re-pointed reads return what they returned before', () => {
  it(CAPTURE ? 'captures the golden' : 'matches the golden', async () => {
    const now = JSON.parse(JSON.stringify(canon(await collectProbes()))) as Record<string, unknown>;
    if (CAPTURE) {
      expect((now.getAllCells as unknown[]).length).toBeGreaterThan(0);
      mkdirSync(dirname(GOLDEN!), { recursive: true });
      writeFileSync(GOLDEN!, JSON.stringify(now));
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN!, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());

    // Collect every mismatching probe in one pass (not just the alphabetically
    // first) so a single run surfaces every broken probe, not only one of them.
    // Pass/fail semantics are unchanged: this still passes only when every key
    // deep-equals the golden.
    const mismatches: string[] = [];
    for (const key of Object.keys(golden)) {
      try {
        expect(now[key], key).toEqual(golden[key]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Cap each probe's diff to a few lines — the full expect/vitest diff can
        // be huge for a large probe, and we want a short diff per key, not a wall
        // of text once several probes mismatch.
        const shortDiff = message.split('\n').slice(0, 20).join('\n');
        mismatches.push(`--- ${key} ---\n${shortDiff}`);
      }
    }
    expect(mismatches.length, `${mismatches.length} probe(s) mismatched the golden:\n\n${mismatches.join('\n\n')}`).toBe(0);
  }, 300_000);
});
