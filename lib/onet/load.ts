/**
 * P1 Task 4 — pure O*NET 31.0 CSV parsing for the reference-store loader.
 * See docs/superpowers/plans/2026-10-12-competency-catalog-p1.md Ruling 5
 * and .superpowers/sdd/2026-10-12-competency-catalog-p1/task-4-brief.md.
 *
 * This module does NO I/O: it takes already-read CSV text and returns typed
 * rows + warnings/skip-counts. The CLI (scripts/onet/load-onet.ts) does the
 * file reads, the DB-identity check, the rated-code lookup and the write.
 *
 * Every parser validates its header against the file's known column list
 * and throws, naming both the file and the missing/renamed column, rather
 * than silently reading garbage into the wrong field.
 */
import Papa from 'papaparse';

// ─── Fixed O*NET attribution block (CC BY 4.0 — global-constraints.md) ────

export interface OnetReleaseMetadata {
  published: string;
  license: string;
  attribution: string;
  sourceUrl: string;
}

/**
 * Known O*NET release metadata (P1 hostile-review fix wave, m4). The
 * loader's `--release` flag used to be free text, with the published date
 * and attribution hard-coded to 31.0's values regardless — `--release
 * 32.0` would have written a 31.0 attribution and an "August 2026" publish
 * date under a release named 32.0. Add a new release's row here, with its
 * OWN published date/attribution/source URL, before ever loading it;
 * `getOnetReleaseMetadata` refuses any release not listed here.
 */
export const ONET_RELEASE_METADATA: Readonly<Record<string, OnetReleaseMetadata>> = {
  '31.0': {
    published: 'August 2026',
    license: 'CC BY 4.0',
    attribution:
      'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, ' +
      'Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.',
    sourceUrl: 'https://www.onetcenter.org/database.html',
  },
};

/** Throws naming the release if it has no metadata row above. */
export function getOnetReleaseMetadata(release: string): OnetReleaseMetadata {
  const meta = ONET_RELEASE_METADATA[release];
  if (!meta) {
    throw new Error(`onet: no known metadata for release "${release}" — add it to ONET_RELEASE_METADATA in lib/onet/load.ts before loading it`);
  }
  return meta;
}
// Final whole-branch review, m-E: the standalone ONET_PUBLISHED/ONET_LICENSE/
// ONET_SOURCE_URL/ONET_ATTRIBUTION "back-compat" constants that used to live
// here had no real callers left — writeOnetStore and occupation-report both
// read per-release metadata via getOnetReleaseMetadata/ONET_RELEASE_METADATA
// now, and the one remaining caller was a test (inlined, see
// tests/lib/onet/load.test.ts). Deleted rather than kept as unused exports.

// ─── Domain mapping (Ruling 5) ─────────────────────────────────────────────

export type Domain = 'knowledge' | 'abilities' | 'work_activities' | 'essential_skills' | 'transferable_skills';

export const DOMAIN_BY_FILENAME: Readonly<Record<string, Domain>> = {
  'knowledge.csv': 'knowledge',
  'abilities.csv': 'abilities',
  'work_activities.csv': 'work_activities',
  'essential_skills.csv': 'essential_skills',
  'transferable_skills.csv': 'transferable_skills',
};

export const ELEMENT_FILENAMES: readonly string[] = Object.keys(DOMAIN_BY_FILENAME);

/** Throws on a filename not in the fixed domain map. */
export function domainForFile(filename: string): Domain {
  const domain = DOMAIN_BY_FILENAME[filename];
  if (!domain) {
    throw new Error(
      `onet/load: unrecognized element file "${filename}" (expected one of ${ELEMENT_FILENAMES.join(', ')})`,
    );
  }
  return domain;
}

// ─── Scale filters (Ruling 5) ──────────────────────────────────────────────

export const ELEMENT_SCALES: ReadonlySet<string> = new Set(['IM', 'LV']);
export const TASK_RATING_SCALES: ReadonlySet<string> = new Set(['IM', 'RT', 'FT']);

// ─── Shared field helpers ───────────────────────────────────────────────────

/** Blank -> false; 'Y' -> true; 'N' -> false. Anything else is a refusal. */
export function parseYn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === '') return false;
  if (v === 'Y') return true;
  if (v === 'N') return false;
  throw new Error(`onet/load: unexpected Y/N value "${raw}"`);
}

/** FT task ratings carry a category (1-7); every other scale stores ''. */
export function taskRatingCategory(scaleId: string, rawCategory: string | undefined): string {
  return scaleId === 'FT' ? (rawCategory ?? '').trim() : '';
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const v = (raw ?? '').trim();
  return v === '' ? null : Number(v);
}

/** Generic code-set filter, usable on any row shaped { onetSocCode }. */
export function filterToCodes<T extends { onetSocCode: string }>(
  rows: readonly T[],
  codes: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => codes.has(r.onetSocCode));
}

// ─── Header-validated CSV parse ────────────────────────────────────────────

const ELEMENT_HEADER = [
  'O*NET-SOC Code', 'Title', 'Element ID', 'Element Name', 'Scale ID', 'Scale Name',
  'Data Value', 'N', 'Standard Error', 'Lower CI Bound', 'Upper CI Bound',
  'Recommend Suppress', 'Not Relevant', 'Date', 'Domain Source',
] as const;

const TASK_RATINGS_HEADER = [
  'O*NET-SOC Code', 'Title', 'Task ID', 'Task', 'Scale ID', 'Scale Name', 'Category',
  'Data Value', 'N', 'Standard Error', 'Lower CI Bound', 'Upper CI Bound',
  'Recommend Suppress', 'Date', 'Domain Source',
] as const;

const TASK_STATEMENTS_HEADER = [
  'O*NET-SOC Code', 'Title', 'Task ID', 'Task', 'Task Type', 'Incumbents Responding', 'Date', 'Domain Source',
] as const;

const OCCUPATION_HEADER = ['O*NET-SOC Code', 'Title', 'Description'] as const;

function parseRecords(content: string, fileLabel: string, expectedHeader: readonly string[]): Record<string, string>[] {
  const clean = content.replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    throw new Error(`onet/load: ${fileLabel}: CSV parse error near row ${first.row ?? '?'}: ${first.message}`);
  }
  const actualHeader = parsed.meta.fields ?? [];
  for (const col of expectedHeader) {
    if (!actualHeader.includes(col)) {
      throw new Error(
        `onet/load: ${fileLabel}: missing or renamed column "${col}" (found header: ${actualHeader.join(', ')})`,
      );
    }
  }
  return parsed.data;
}

// ─── Row shapes ─────────────────────────────────────────────────────────────

export interface RawOccupation {
  onetSocCode: string;
  title: string;
  description: string;
}

export interface RawElementRating {
  onetSocCode: string;
  domain: Domain;
  elementId: string;
  elementName: string;
  scaleId: string; // 'IM' | 'LV'
  dataValue: number;
  n: number | null;
  standardError: number | null;
  recommendSuppress: boolean;
  notRelevant: boolean;
  dateText: string;
  domainSource: string;
}

export interface RawTaskStatement {
  onetSocCode: string;
  taskId: string;
  task: string;
  taskType: string | null;
}

export interface RawTaskRating {
  onetSocCode: string;
  taskId: string;
  scaleId: string; // 'IM' | 'RT' | 'FT'
  category: string;
  dataValue: number;
  n: number | null;
  standardError: number | null;
  recommendSuppress: boolean;
  dateText: string;
  domainSource: string;
}

export interface ScaleFilteredResult<T> {
  rows: T[];
  skippedScaleCount: number;
}

// ─── Parsers ────────────────────────────────────────────────────────────────

export function parseOccupationDataCsv(content: string, fileLabel: string): { rows: RawOccupation[] } {
  const records = parseRecords(content, fileLabel, OCCUPATION_HEADER);
  return {
    rows: records.map((r) => ({
      onetSocCode: r['O*NET-SOC Code']!.trim(),
      title: r['Title']!.trim(),
      description: r['Description']!.trim(),
    })),
  };
}

/**
 * Parses one element-ratings file (knowledge/abilities/work_activities/
 * essential_skills/transferable_skills). Keeps only IM and LV scale rows;
 * every other scale is skipped and counted (Ruling 5). Code-set filtering
 * is a separate step (filterToCodes) — not done here.
 */
export function parseElementRatingsCsv(
  content: string,
  fileLabel: string,
  domain: Domain,
): ScaleFilteredResult<RawElementRating> {
  const records = parseRecords(content, fileLabel, ELEMENT_HEADER);
  const rows: RawElementRating[] = [];
  let skippedScaleCount = 0;
  for (const r of records) {
    const scaleId = r['Scale ID']!.trim();
    if (!ELEMENT_SCALES.has(scaleId)) {
      skippedScaleCount++;
      continue;
    }
    rows.push({
      onetSocCode: r['O*NET-SOC Code']!.trim(),
      domain,
      elementId: r['Element ID']!.trim(),
      elementName: r['Element Name']!.trim(),
      scaleId,
      dataValue: Number(r['Data Value']),
      n: parseOptionalNumber(r['N']),
      standardError: parseOptionalNumber(r['Standard Error']),
      recommendSuppress: parseYn(r['Recommend Suppress']),
      notRelevant: parseYn(r['Not Relevant']),
      dateText: r['Date']!.trim(),
      domainSource: r['Domain Source']!.trim(),
    });
  }
  return { rows, skippedScaleCount };
}

export function parseTaskStatementsCsv(content: string, fileLabel: string): { rows: RawTaskStatement[] } {
  const records = parseRecords(content, fileLabel, TASK_STATEMENTS_HEADER);
  return {
    rows: records.map((r) => {
      const taskType = (r['Task Type'] ?? '').trim();
      return {
        onetSocCode: r['O*NET-SOC Code']!.trim(),
        taskId: r['Task ID']!.trim(),
        task: r['Task']!.trim(),
        taskType: taskType === '' ? null : taskType,
      };
    }),
  };
}

/**
 * Parses task_ratings.csv. Keeps only IM, RT and FT scale rows; every other
 * scale is skipped and counted (Ruling 5). FT rows keep their category
 * (1-7); IM/RT rows store category '' (taskRatingCategory).
 */
export function parseTaskRatingsCsv(content: string, fileLabel: string): ScaleFilteredResult<RawTaskRating> {
  const records = parseRecords(content, fileLabel, TASK_RATINGS_HEADER);
  const rows: RawTaskRating[] = [];
  let skippedScaleCount = 0;
  for (const r of records) {
    const scaleId = r['Scale ID']!.trim();
    if (!TASK_RATING_SCALES.has(scaleId)) {
      skippedScaleCount++;
      continue;
    }
    rows.push({
      onetSocCode: r['O*NET-SOC Code']!.trim(),
      taskId: r['Task ID']!.trim(),
      scaleId,
      category: taskRatingCategory(scaleId, r['Category']),
      dataValue: Number(r['Data Value']),
      n: parseOptionalNumber(r['N']),
      standardError: parseOptionalNumber(r['Standard Error']),
      recommendSuppress: parseYn(r['Recommend Suppress']),
      dateText: r['Date']!.trim(),
      domainSource: r['Domain Source']!.trim(),
    });
  }
  return { rows, skippedScaleCount };
}
