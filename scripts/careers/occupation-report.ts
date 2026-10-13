/**
 * P1 Task 4 — read-only occupation report.
 *
 * For each career target and horizon, prints the occupation mix (SOC,
 * O*NET code, title, status, share) plus the combined unrated + no-fit
 * share, then the top 15 O*NET elements by share-weighted Importance
 * across that mix's `rated` rows (recommend_suppress ratings are skipped
 * and counted, never scored). Ends with that release's own CC BY 4.0
 * attribution (read back from onet_release, not a hard-coded constant —
 * see m4 below). See docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
 * Ruling 5 §5.4 and .superpowers/sdd/2026-10-12-competency-catalog-p1/task-4-brief.md.
 *
 * This script never writes to the database — it is read-only by
 * construction (no insert/update/delete anywhere in this file).
 *
 * Usage (DATABASE_URL set explicitly to the scratch clone):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/careers/occupation-report.ts [--release 31.0]
 *
 * m4 (hostile-review fix wave): the release used to be read with no WHERE
 * and no ORDER BY — with exactly one row loaded that happened to work, but
 * it "picks one arbitrarily" the moment a second release exists. --release
 * now picks a specific one (refuses if it doesn't exist); omitting it picks
 * the most recently loaded release explicitly (onet_release.loaded_at
 * DESC), never an unordered first-row. The report always states, by name,
 * which release it used.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargets, careerTargetOccupations, onetOccupations, onetElementRatings, onetRelease } from '@/lib/db/schema';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';

type Executor = typeof db;
type Horizon = 'entry' | 'growth';
const HORIZONS: readonly Horizon[] = ['entry', 'growth'];

// ─── Pure scoring helper (unit-tested directly — see tests/scripts/careers/occupation-report.test.ts) ──

export interface MixShareRow {
  onetSocCode: string | null;
  onetStatus: string; // 'rated' | 'unrated' | 'no_fit'
  share: number;
}

export interface ElementImportanceRow {
  onetSocCode: string;
  domain: string;
  elementId: string;
  elementName: string;
  scaleId: string; // only 'IM' rows are meaningful here
  dataValue: number;
  recommendSuppress: boolean;
}

export interface ElementScore {
  domain: string;
  elementId: string;
  elementName: string;
  score: number;
}

/** Spec §5.4: rescaled IM = (IM - 1) / 4, mapping the 1-5 Importance scale onto 0-1. */
export function rescaleImportance(im: number): number {
  return (im - 1) / 4;
}

/**
 * Top-`limit` O*NET elements by Σ(share × rescaled IM) across one target's
 * mix. Only `rated` mix rows contribute a share; `elementRatings` rows
 * flagged `recommendSuppress` are skipped (counted in `suppressedCount`)
 * rather than scored. Pure function — no I/O.
 */
export function topElementsByShareWeightedImportance(
  mixRows: readonly MixShareRow[],
  elementRatings: readonly ElementImportanceRow[],
  limit = 15,
): { top: ElementScore[]; suppressedCount: number } {
  const shareByCode = new Map<string, number>();
  for (const m of mixRows) {
    if (m.onetStatus !== 'rated' || !m.onetSocCode) continue;
    shareByCode.set(m.onetSocCode, (shareByCode.get(m.onetSocCode) ?? 0) + m.share);
  }

  let suppressedCount = 0;
  const scoreByKey = new Map<string, ElementScore>();
  for (const r of elementRatings) {
    if (r.scaleId !== 'IM') continue;
    const share = shareByCode.get(r.onetSocCode);
    if (share === undefined) continue;
    if (r.recommendSuppress) {
      suppressedCount++;
      continue;
    }
    const key = `${r.domain}\u0000${r.elementId}`;
    const contribution = share * rescaleImportance(r.dataValue);
    const existing = scoreByKey.get(key);
    if (existing) existing.score += contribution;
    else scoreByKey.set(key, { domain: r.domain, elementId: r.elementId, elementName: r.elementName, score: contribution });
  }

  const top = Array.from(scoreByKey.values()).sort((a, b) => b.score - a.score).slice(0, limit);
  return { top, suppressedCount };
}

// ─── Read-only report ───────────────────────────────────────────────────────

export async function runReport(executor: Executor = db, requestedRelease?: string): Promise<string[]> {
  const lines: string[] = [];

  // m4 (hostile-review fix wave): explicit release selection, never an
  // unordered first row. --release picks a specific one (refuses if it has
  // no onet_release row); omitting it picks the most recently loaded
  // release (loaded_at DESC) — with today's single release this is the
  // same value either way, but it's now EXPLICIT rather than "whichever
  // row Postgres happened to return first."
  let releaseRow: { release: string; attribution: string } | undefined;
  if (requestedRelease) {
    [releaseRow] = await executor
      .select({ release: onetRelease.release, attribution: onetRelease.attribution })
      .from(onetRelease)
      .where(eq(onetRelease.release, requestedRelease));
    if (!releaseRow) {
      throw new Error(`occupation-report: release "${requestedRelease}" has no onet_release row — load it with scripts/onet/load-onet.ts first`);
    }
  } else {
    [releaseRow] = await executor
      .select({ release: onetRelease.release, attribution: onetRelease.attribution })
      .from(onetRelease)
      .orderBy(desc(onetRelease.loadedAt))
      .limit(1);
  }
  const release = releaseRow?.release ?? null;
  lines.push(release ? `release: ${release}` : '(no O*NET release loaded)');

  const targets = await executor
    .select({ id: careerTargets.id, name: careerTargets.name })
    .from(careerTargets)
    .orderBy(asc(careerTargets.displayOrder));

  for (const target of targets) {
    for (const horizon of HORIZONS) {
      const mix = await executor
        .select({
          socCode: careerTargetOccupations.socCode,
          onetSocCode: careerTargetOccupations.onetSocCode,
          onetStatus: careerTargetOccupations.onetStatus,
          share: careerTargetOccupations.share,
        })
        .from(careerTargetOccupations)
        .where(and(eq(careerTargetOccupations.careerTargetId, target.id), eq(careerTargetOccupations.horizon, horizon)))
        .orderBy(desc(careerTargetOccupations.share));

      if (mix.length === 0) continue;

      const titleByCode = new Map<string, string>();
      if (release) {
        const ratedCodes = Array.from(new Set(mix.filter(m => m.onetStatus === 'rated' && m.onetSocCode).map(m => m.onetSocCode!)));
        if (ratedCodes.length > 0) {
          const occRows = await executor
            .select({ onetSocCode: onetOccupations.onetSocCode, title: onetOccupations.title })
            .from(onetOccupations)
            .where(and(eq(onetOccupations.release, release), inArray(onetOccupations.onetSocCode, ratedCodes)));
          for (const o of occRows) titleByCode.set(o.onetSocCode, o.title);
        }
      }

      lines.push(`\n=== ${target.name} (${target.id}) — ${horizon} ===`);
      lines.push('soc_code | onet_code | title | status | share');
      let unratedShare = 0;
      let noFitShare = 0;
      for (const row of mix) {
        if (row.onetStatus === 'unrated') unratedShare += row.share;
        if (row.onetStatus === 'no_fit') noFitShare += row.share;
        const title = row.onetSocCode ? (titleByCode.get(row.onetSocCode) ?? '-') : '-';
        lines.push(`${row.socCode} | ${row.onetSocCode ?? '-'} | ${title} | ${row.onetStatus} | ${row.share.toFixed(4)}`);
      }
      lines.push(`unrated share: ${unratedShare.toFixed(4)}  no_fit share: ${noFitShare.toFixed(4)}  combined: ${(unratedShare + noFitShare).toFixed(4)}`);

      if (release) {
        const ratedCodes = Array.from(new Set(mix.filter(m => m.onetStatus === 'rated' && m.onetSocCode).map(m => m.onetSocCode!)));
        let elementRatingRows: ElementImportanceRow[] = [];
        if (ratedCodes.length > 0) {
          elementRatingRows = await executor
            .select({
              onetSocCode: onetElementRatings.onetSocCode,
              domain: onetElementRatings.domain,
              elementId: onetElementRatings.elementId,
              elementName: onetElementRatings.elementName,
              scaleId: onetElementRatings.scaleId,
              dataValue: onetElementRatings.dataValue,
              recommendSuppress: onetElementRatings.recommendSuppress,
            })
            .from(onetElementRatings)
            .where(and(
              eq(onetElementRatings.release, release),
              inArray(onetElementRatings.onetSocCode, ratedCodes),
              eq(onetElementRatings.scaleId, 'IM'),
            ));
        }
        const { top, suppressedCount } = topElementsByShareWeightedImportance(mix, elementRatingRows, 15);
        lines.push(`\ntop ${top.length} elements by Σ(share × rescaled IM)  (${suppressedCount} recommend_suppress rating(s) skipped):`);
        top.forEach((e, i) => {
          lines.push(`  ${i + 1}. ${e.elementName} [${e.domain}] — ${e.score.toFixed(4)}`);
        });
      } else {
        lines.push('\n(no O*NET release loaded — top-elements scoring skipped)');
      }
    }
  }

  // THIS release's own attribution text, read back from onet_release — not
  // a hard-coded constant (m4). Nothing to attribute if no release was
  // ever loaded (the mix-only report above still ran; it just had no
  // titles/top-elements).
  if (releaseRow) {
    lines.push('\n' + releaseRow.attribution);
  }
  return lines;
}

// ─── Entry point ────────────────────────────────────────────────────────────

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** --release is optional: omitting it reports against the most recently loaded release. */
export async function main(argv: string[] = []): Promise<number> {
  const release = argValueFrom(argv, '--release');
  try {
    const lines = await runReport(db, release);
    for (const line of lines) console.log(line);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
