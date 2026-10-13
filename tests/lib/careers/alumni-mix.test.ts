// @vitest-environment node
// P1 Task 3 — pure transform tests for buildOccupationMix (Rulings 1-3).
// Small synthetic exports only; no DB, no real gc_alumni file.
import { describe, it, expect } from 'vitest';
import { buildOccupationMix, TARGET_LABEL_MAP } from '@/lib/careers/alumni-mix';

const STAMP = { data: 'abc123def456', commit: 'cafef00d', generated: '2026-10-11' };

function baseExport(overrides: Record<string, unknown> = {}) {
  return {
    _definitions: {},
    _codes: {},
    entry: { population: 0, onet_detail_coverage: 0, by_target: {} },
    growth_registrar_era: { population: 0, onet_detail_coverage: 0, by_target: {} },
    growth_all_validated: { population: 0, onet_detail_coverage: 0, by_target: {} },
    _stamp: STAMP,
    ...overrides,
  };
}

describe('buildOccupationMix — Ruling 2 (target labels)', () => {
  it('maps every fixed label to its career target id', () => {
    const byTarget: Record<string, unknown> = {};
    for (const label of Object.keys(TARGET_LABEL_MAP)) {
      byTarget[label] = { n: 10, occupations: [{ soc: '11-1011', count: 10, share: 1 }] };
    }
    const exportJson = baseExport({ entry: { by_target: byTarget } });
    const { rows } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    const ids = new Set(rows.map(r => r.careerTargetId));
    expect(ids).toEqual(new Set(Object.values(TARGET_LABEL_MAP)));
  });

  it('refuses an unknown target label', () => {
    const exportJson = baseExport({
      entry: { by_target: { 'nope not a real label': { n: 1, occupations: [{ soc: '11-1011', count: 1, share: 1 }] } } },
    });
    expect(() => buildOccupationMix(exportJson, new Set())).toThrow(/unknown target label/);
  });
});

describe('buildOccupationMix — Ruling 3 (SOC -> O*NET rule)', () => {
  it('a rated .00 maps to rated with that code', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': { n: 10, occupations: [{ soc: '11-1011', count: 10, share: 1 }] },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    expect(rows).toEqual([{
      careerTargetId: 'production-operations', horizon: 'entry', socCode: '11-1011',
      onetSocCode: '11-1011.00', onetStatus: 'rated', count: 10, share: 1,
      sourceVersion: `${STAMP.commit}/${STAMP.data}`, asOf: STAMP.generated,
    }]);
  });

  it('a SOC without a rated .00 maps to unrated, NULL code, never averaged over children', () => {
    // '15-1299.01' being rated must NOT cause 15-1299 to be treated as rated.
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': { n: 10, occupations: [{ soc: '15-1299', count: 10, share: 1 }] },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['15-1299.01']));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ socCode: '15-1299', onetSocCode: null, onetStatus: 'unrated', count: 10 });
  });

  it('an onet_detail split across .00 and .01 produces two rows whose counts sum to the SOC count', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 10,
            occupations: [{
              soc: '13-1161', count: 10, share: 1,
              onet_detail: [{ onet_code: '13-1161.00', count: 7 }, { onet_code: '13-1161.01', count: 3 }],
            }],
          },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['13-1161.00', '13-1161.01']));
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(10);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ socCode: '13-1161', onetSocCode: '13-1161.00', onetStatus: 'rated', count: 7, share: 0.7 }),
      expect.objectContaining({ socCode: '13-1161', onetSocCode: '13-1161.01', onetStatus: 'rated', count: 3, share: 0.3 }),
    ]));
  });

  it('an onet_detail entry of "none" maps to no_fit with a NULL code', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 3,
            occupations: [{ soc: '13-1199', count: 3, share: 1, onet_detail: [{ onet_code: 'none', count: 3 }] }],
          },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ socCode: '13-1199', onetSocCode: null, onetStatus: 'no_fit', count: 3 });
  });

  it('a detail code not in the rated set maps to unrated (NULL code), never the literal unrated code', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 10,
            occupations: [{
              soc: '13-1161', count: 10, share: 1,
              onet_detail: [{ onet_code: '13-1161.00', count: 7 }, { onet_code: '13-1161.01', count: 3 }],
            }],
          },
        },
      },
    });
    // Only .00 is rated here; .01 has no knowledge.csv rows in this fixture.
    const { rows } = buildOccupationMix(exportJson, new Set(['13-1161.00']));
    const unrated = rows.find(r => r.count === 3);
    expect(unrated).toMatchObject({ onetSocCode: null, onetStatus: 'unrated' });
  });

  it('refuses when onet_detail counts do not sum to the SOC count', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 10,
            occupations: [{
              soc: '13-1161', count: 10, share: 1,
              onet_detail: [{ onet_code: '13-1161.00', count: 7 }, { onet_code: '13-1161.01', count: 2 }],
            }],
          },
        },
      },
    });
    expect(() => buildOccupationMix(exportJson, new Set(['13-1161.00', '13-1161.01']))).toThrow(/onet_detail counts sum to/);
  });
});

describe('buildOccupationMix — shares', () => {
  it('computes share as count/n, and shares within a (target, horizon) sum to 1 within 0.001', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 7,
            occupations: [
              { soc: '11-1011', count: 4, share: 0.5714 },
              { soc: '15-1299', count: 3, share: 0.4286 },
            ],
          },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    expect(rows.map(r => r.share)).toEqual([4 / 7, 3 / 7]);
    const sum = rows.reduce((s, r) => s + r.share, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
  });

  it('refuses when the computed share disagrees with the export share by more than 0.001', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 10,
            occupations: [{ soc: '11-1011', count: 10, share: 0.5 }], // computed share is 1.0, not 0.5
          },
        },
      },
    });
    expect(() => buildOccupationMix(exportJson, new Set(['11-1011.00']))).toThrow(/disagrees with the export's rounded share/);
  });

  it('warns (does not refuse) when an occupation has no "share" field to cross-check', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': { n: 10, occupations: [{ soc: '11-1011', count: 10 }] },
        },
      },
    });
    const { rows, warnings } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    expect(rows).toHaveLength(1);
    expect(warnings.some(w => w.includes('no "share" field'))).toBe(true);
  });
});

describe('buildOccupationMix — source_version / as_of / refusals / growth_all_validated', () => {
  it('builds source_version from _stamp.commit/_stamp.data and as_of from _stamp.generated', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': { n: 1, occupations: [{ soc: '11-1011', count: 1, share: 1 }] },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    expect(rows[0]!.sourceVersion).toBe(`${STAMP.commit}/${STAMP.data}`);
    expect(rows[0]!.asOf).toBe(STAMP.generated);
  });

  it('refuses when _stamp is missing', () => {
    const exportJson = baseExport();
    delete (exportJson as Record<string, unknown>)._stamp;
    expect(() => buildOccupationMix(exportJson, new Set())).toThrow(/_stamp/);
  });

  it('refuses when entry is missing', () => {
    const exportJson = baseExport();
    delete (exportJson as Record<string, unknown>).entry;
    expect(() => buildOccupationMix(exportJson, new Set())).toThrow(/entry/);
  });

  it('refuses when growth_registrar_era is missing', () => {
    const exportJson = baseExport();
    delete (exportJson as Record<string, unknown>).growth_registrar_era;
    expect(() => buildOccupationMix(exportJson, new Set())).toThrow(/growth_registrar_era/);
  });

  it('ignores growth_all_validated entirely, even when it is malformed', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': { n: 1, occupations: [{ soc: '11-1011', count: 1, share: 1 }] },
        },
      },
      growth_all_validated: { by_target: { 'not a real label': { n: 'nonsense' } } },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['11-1011.00']));
    expect(rows).toHaveLength(1);
  });
});

// ─── P1 hostile-review fix wave, m1 ────────────────────────────────────────
// UNIQUE NULLS NOT DISTINCT on (career_target_id, horizon, soc_code,
// onet_soc_code, source) treats two NULL onet_soc_code rows as a collision.
// Before this fix, buildOccupationMix had no way to catch that — only the
// DB's own CHECK/UNIQUE did, at --apply time, so a dry run could print
// clean and exit 0 on data that --apply would then refuse.
describe('buildOccupationMix — m1 (dry run must catch what --apply would refuse)', () => {
  it('refuses when an explicit "none" and an unrated child code both resolve to a NULL onet_soc_code for the same SOC', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 3,
            occupations: [{
              soc: '13-1199',
              count: 3,
              share: 1,
              // 'none' -> no_fit (NULL code); '13-1199.01' is not in the
              // rated set -> unrated (also NULL code). Both rows end up
              // with the identical (target, horizon, soc, NULL) key.
              onet_detail: [{ onet_code: 'none', count: 1 }, { onet_code: '13-1199.01', count: 2 }],
            }],
          },
        },
      },
    });
    // '13-1199.01' deliberately absent from the rated set below.
    expect(() => buildOccupationMix(exportJson, new Set(['11-1011.00']))).toThrow(
      /two rows both resolve to onet_soc_code NULL/,
    );
  });

  it('refuses when two unrated child codes under the same SOC both resolve to a NULL onet_soc_code', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 3,
            occupations: [{
              soc: '13-1199',
              count: 3,
              share: 1,
              onet_detail: [{ onet_code: '13-1199.01', count: 1 }, { onet_code: '13-1199.02', count: 2 }],
            }],
          },
        },
      },
    });
    expect(() => buildOccupationMix(exportJson, new Set(['11-1011.00']))).toThrow(
      /two rows both resolve to onet_soc_code NULL/,
    );
  });

  it('refuses a row with count = 0', () => {
    // A second, separately-counted occupation fills the target's share sum
    // to 1 on its own, so the pre-existing share-sum-to-1 check (which
    // runs first, inside processSection) doesn't mask the count=0 check
    // this test is actually for.
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 3,
            occupations: [
              { soc: '11-1011', count: 3, share: 1 },
              { soc: '13-1199', count: 0, share: 0 },
            ],
          },
        },
      },
    });
    expect(() => buildOccupationMix(exportJson, new Set(['11-1011.00']))).toThrow(/count = 0, expected > 0/);
  });

  // Positive control (green): the validator must NOT misfire on the
  // ordinary, non-colliding shape every other test in this file relies on
  // — two DIFFERENT rated children under one SOC, each with its own
  // distinct, non-NULL onet_soc_code.
  it('does not refuse two distinct rated onet_detail children under the same SOC', () => {
    const exportJson = baseExport({
      entry: {
        by_target: {
          '1 Production & Operations': {
            n: 10,
            occupations: [{
              soc: '13-1161',
              count: 10,
              share: 1,
              onet_detail: [{ onet_code: '13-1161.00', count: 7 }, { onet_code: '13-1161.01', count: 3 }],
            }],
          },
        },
      },
    });
    const { rows } = buildOccupationMix(exportJson, new Set(['13-1161.00', '13-1161.01']));
    expect(rows).toHaveLength(2);
  });
});
