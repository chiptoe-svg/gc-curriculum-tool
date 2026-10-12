// @vitest-environment node
// P0a characterization (scratch DB only; run ALONE, never in the same vitest
// invocation as other DB tests). Capture: P0A_CAPTURE=1 writes the golden.
// Compare: every probe must deep-equal the golden.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canon, collectCoverageTieSets, collectProbes, tieAwareTargetSubstrate } from './p0a/probes';
import { isCharacterizationDb } from './p0a/scratch-guard';

const GOLDEN = process.env.P0A_GOLDEN;
const CAPTURE = process.env.P0A_CAPTURE === '1';

// isCharacterizationDb() (not isScratchDb()) because P0b (Task 1) reuses
// this read-only probe set to capture its own pre-0057 golden against its
// scratch clones — see tests/db/p0a/scratch-guard.ts.
describe.skipIf(!isCharacterizationDb() || !GOLDEN)('P0a characterization: re-pointed reads return what they returned before', () => {
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

    // loadTargetSubstrate only (controller ruling, 2026-10-11): widen the
    // comparison for sub-competencies with more than one cell tied at the max
    // dDepth, since the legacy "best cell" pick depended on unordered-SELECT
    // row order — never a stable behavior — and now that
    // loadTargetSubstrate's cellRows query reads the target_coverage view
    // instead of the base table, ties can legitimately resolve to a
    // different (but equally valid) winner. See probes.ts
    // tieAwareTargetSubstrate's doc comment. Applied to BOTH sides with the
    // SAME live-computed tie sets; golden.json itself is never rewritten.
    // Non-tied entries, and any entry whose max depth itself changed, are
    // untouched and still compared exactly. Each side's own recorded winner
    // must also still be a genuine member of the live tie set (fix round 1,
    // 2026-10-11 review) — tieAwareTargetSubstrate checks this per side, so a
    // golden winner that no longer exists among the live candidates at all
    // stays raw and the comparison still fails.
    const tieSets = await collectCoverageTieSets();

    // Collect every mismatching probe in one pass (not just the alphabetically
    // first) so a single run surfaces every broken probe, not only one of them.
    // Pass/fail semantics are unchanged: this still passes only when every key
    // deep-equals the golden.
    const mismatches: string[] = [];
    for (const key of Object.keys(golden)) {
      try {
        if (key === 'loadTargetSubstrate') {
          type TSValue = Parameters<typeof tieAwareTargetSubstrate>[0];
          expect(
            tieAwareTargetSubstrate(now[key] as TSValue, tieSets),
            key,
          ).toEqual(tieAwareTargetSubstrate(golden[key] as TSValue, tieSets));
          continue;
        }
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
