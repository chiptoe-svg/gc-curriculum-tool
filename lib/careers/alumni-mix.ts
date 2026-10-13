/**
 * P1 Task 3 (migration 0058) — pure transform from gc_alumni's
 * career_demand.json export into career_target_occupations rows for the
 * 'alumni_rule' source. See docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
 * Rulings 1-3.
 *
 * This module does NO I/O: it takes the already-parsed export JSON and an
 * already-built set of "rated" O*NET codes (whatever has rows in
 * scratch/onet/31.0/knowledge.csv) and returns rows + warnings. The CLI
 * (scripts/careers/ingest-alumni-mix.ts) does the file read, the
 * knowledge.csv scan, and the DB write.
 */

// ─── Ruling 2: fixed target-label map; any other label refuses ────────────
export const TARGET_LABEL_MAP: Readonly<Record<string, string>> = {
  '1 Production & Operations': 'production-operations',
  '2 Sales Solutions & Account Management': 'account-management',
  '3 Brand Strategy & Experience': 'brand-strategy',
  '4 Purposeful Design & Creative Generalist': 'creative-generalist',
  '5 Creative Technology & Systems': 'ai-workflow',
};

export type Horizon = 'entry' | 'growth';
export type OnetStatus = 'rated' | 'unrated' | 'no_fit';

export interface OccupationMixRow {
  careerTargetId: string;
  horizon: Horizon;
  socCode: string;
  onetSocCode: string | null;
  onetStatus: OnetStatus;
  count: number;
  share: number;
  sourceVersion: string;
  asOf: string;
}

/** Share disagreement tolerance against the export's own rounded `share` field (Rulings context). */
const SHARE_TOLERANCE = 0.001;

// ─── Narrow runtime shape of the export (gc_alumni's career_demand.json) ──

interface RawOnetDetailEntry {
  onet_code: string;
  count: number;
}

interface RawOccupation {
  soc: string;
  count: number;
  share?: number;
  onet_detail?: RawOnetDetailEntry[];
}

interface RawByTarget {
  n: number;
  occupations: RawOccupation[];
}

interface RawSection {
  by_target: Record<string, RawByTarget>;
}

interface RawStamp {
  data: string;
  commit: string;
  generated: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readStamp(exportJson: Record<string, unknown>): RawStamp {
  const stamp = exportJson['_stamp'];
  if (
    !isRecord(stamp) ||
    typeof stamp.commit !== 'string' ||
    typeof stamp.data !== 'string' ||
    typeof stamp.generated !== 'string'
  ) {
    throw new Error('alumni-mix: export is missing a usable "_stamp" (needs string commit, data, generated)');
  }
  return { commit: stamp.commit, data: stamp.data, generated: stamp.generated };
}

function readSection(exportJson: Record<string, unknown>, key: 'entry' | 'growth_registrar_era'): RawSection {
  const section = exportJson[key];
  if (!isRecord(section) || !isRecord(section['by_target'])) {
    throw new Error(`alumni-mix: export is missing "${key}.by_target"`);
  }
  return section as unknown as RawSection;
}

/** The O*NET code (and its rated/unrated/no_fit status) for one occupation-mix row. */
function classify(code: string, ratedOnetCodes: ReadonlySet<string>): { onetSocCode: string | null; onetStatus: OnetStatus } {
  if (code === 'none') return { onetSocCode: null, onetStatus: 'no_fit' };
  if (ratedOnetCodes.has(code)) return { onetSocCode: code, onetStatus: 'rated' };
  return { onetSocCode: null, onetStatus: 'unrated' };
}

function processSection(
  section: RawSection,
  horizon: Horizon,
  sourceVersion: string,
  asOf: string,
  ratedOnetCodes: ReadonlySet<string>,
  rows: OccupationMixRow[],
  warnings: string[],
): void {
  for (const [label, target] of Object.entries(section.by_target)) {
    const careerTargetId = TARGET_LABEL_MAP[label];
    if (!careerTargetId) {
      throw new Error(`alumni-mix: unknown target label "${label}" (not in TARGET_LABEL_MAP)`);
    }
    const n = target.n;
    if (!(n > 0)) {
      throw new Error(`alumni-mix: target "${label}" (${horizon}) has n = ${n}, expected a positive count`);
    }

    for (const occ of target.occupations) {
      const detail = occ.onet_detail;
      if (detail && detail.length > 0) {
        // Ruling 3: an onet_detail breakdown splits the SOC's count across
        // its listed O*NET codes (or 'none') — never falls back to the
        // SOC's own `.00` code.
        const detailSum = detail.reduce((sum, d) => sum + d.count, 0);
        if (detailSum !== occ.count) {
          throw new Error(
            `alumni-mix: ${horizon}/"${label}"/${occ.soc}: onet_detail counts sum to ${detailSum}, expected ${occ.count}`,
          );
        }
        for (const d of detail) {
          const { onetSocCode, onetStatus } = classify(d.onet_code, ratedOnetCodes);
          rows.push({
            careerTargetId,
            horizon,
            socCode: occ.soc,
            onetSocCode,
            onetStatus,
            count: d.count,
            share: d.count / n,
            sourceVersion,
            asOf,
          });
        }
      } else {
        // No breakdown: classify against this SOC's own `.00` code. A SOC
        // without a rated `.00` is 'unrated' with a NULL code — it is
        // NEVER averaged over child O*NET codes (Ruling 3).
        const { onetSocCode, onetStatus } = classify(`${occ.soc}.00`, ratedOnetCodes);
        rows.push({
          careerTargetId,
          horizon,
          socCode: occ.soc,
          onetSocCode,
          onetStatus,
          count: occ.count,
          share: occ.count / n,
          sourceVersion,
          asOf,
        });
      }

      const lastRows = detail && detail.length > 0 ? rows.slice(-detail.length) : rows.slice(-1);
      const computedShare = lastRows.reduce((sum, r) => sum + r.share, 0);
      if (typeof occ.share === 'number') {
        const diff = Math.abs(computedShare - occ.share);
        if (diff > SHARE_TOLERANCE) {
          throw new Error(
            `alumni-mix: ${horizon}/"${label}"/${occ.soc}: computed share ${computedShare} disagrees with the export's rounded share ${occ.share} by more than ${SHARE_TOLERANCE}`,
          );
        }
      } else {
        warnings.push(`alumni-mix: ${horizon}/"${label}"/${occ.soc} has no "share" field to cross-check against the computed share`);
      }
    }

    // Shares within this (target, horizon) should sum to 1 within rounding.
    const targetShareSum = rows
      .filter(r => r.careerTargetId === careerTargetId && r.horizon === horizon)
      .reduce((sum, r) => sum + r.share, 0);
    if (Math.abs(targetShareSum - 1) > SHARE_TOLERANCE) {
      throw new Error(
        `alumni-mix: ${horizon}/"${label}": shares sum to ${targetShareSum}, expected 1 ± ${SHARE_TOLERANCE}`,
      );
    }
  }
}

/**
 * Pure transform: career_demand.json -> one row per (target, horizon, soc,
 * onet code) for the 'alumni_rule' source. Never touches the DB or the
 * filesystem. Throws (refuses) on any Ruling 1-3 violation; `warnings` is
 * for non-fatal data-shape notes only.
 */
/**
 * m1 (hostile-review fix wave). The DB's UNIQUE NULLS NOT DISTINCT key is
 * (career_target_id, horizon, soc_code, onet_soc_code, source) — source is
 * always 'alumni_rule' here, and Postgres treats NULL onet_soc_code values
 * as EQUAL under NULLS NOT DISTINCT. Two parts of the same occ.soc's
 * onet_detail that both resolve to a NULL onet_soc_code — an explicit
 * 'none' alongside an unrated child code, or two unrated child codes —
 * collide at INSERT time, but buildOccupationMix used to have no way to
 * know that: the dry run printed clean and exited 0, and only --apply's
 * actual INSERT failed. Validating here, in the ONE pure function both the
 * dry run and --apply call, makes the dry run catch it too. Also refuses a
 * non-positive count (the DB's own CHECK) for the same reason.
 */
function validateRows(rows: readonly OccupationMixRow[]): void {
  const seen = new Map<string, OccupationMixRow>();
  for (const r of rows) {
    if (!(r.count > 0)) {
      throw new Error(`alumni-mix: ${r.horizon}/"${r.careerTargetId}"/${r.socCode}: row has count = ${r.count}, expected > 0`);
    }
    const key = `${r.careerTargetId}\u0000${r.horizon}\u0000${r.socCode}\u0000${r.onetSocCode ?? '\u0000NULL'}`;
    const dup = seen.get(key);
    if (dup) {
      throw new Error(
        `alumni-mix: ${r.horizon}/"${r.careerTargetId}"/${r.socCode}: two rows both resolve to onet_soc_code ${r.onetSocCode ?? 'NULL'} — ` +
        `UNIQUE NULLS NOT DISTINCT makes this a duplicate key (likely an explicit 'none' alongside an unrated child code, or two unrated child codes)`,
      );
    }
    seen.set(key, r);
  }
}

export function buildOccupationMix(
  exportJson: unknown,
  ratedOnetCodes: ReadonlySet<string>,
): { rows: OccupationMixRow[]; warnings: string[] } {
  if (!isRecord(exportJson)) {
    throw new Error('alumni-mix: export JSON must be an object');
  }

  const stamp = readStamp(exportJson);
  const sourceVersion = `${stamp.commit}/${stamp.data}`;
  const asOf = stamp.generated;

  const entry = readSection(exportJson, 'entry');
  const growth = readSection(exportJson, 'growth_registrar_era');
  // growth_all_validated (Ruling 1) is intentionally never read here.

  const rows: OccupationMixRow[] = [];
  const warnings: string[] = [];

  processSection(entry, 'entry', sourceVersion, asOf, ratedOnetCodes, rows, warnings);
  processSection(growth, 'growth', sourceVersion, asOf, ratedOnetCodes, rows, warnings);

  validateRows(rows);

  return { rows, warnings };
}
