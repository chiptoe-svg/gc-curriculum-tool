#!/usr/bin/env node
/**
 * Pre-publish citation check for the research pages of this repo.
 *
 * Owner rule (CLAUDE.md, "Research docs cite only held sources", 2026-10-07):
 * a research page may cite a work only if its full text is held locally
 * (docs/references/_pdfs/, git-ignored; or ~/projects/ai_career_impact/library/pdfs/,
 * read-only); otherwise the citation must carry the marker
 * `<sup class="nv" title="Needs confirmation: source not held in full text">&dagger;</sup>`.
 *
 * This script checks, for every page listed in docs/references/held.json:
 *   (a) every reference-list <li> either carries the marker, or maps in
 *       held.json to a file that exists on disk;
 *   (b) if a ledger exists at docs/references/ledgers/<page-basename>.json,
 *       every claim's quote is found (after normalization) in its held
 *       source's extracted text;
 *   (c) reports (never fails on) the count of "needs confirmation" markers
 *       per page, and ledger coverage.
 *
 * Exit code 1 only on ERRORs (an unheld+unmarked reference, or a ledger
 * quote not found in its source). A missing ledger is a note, not an error.
 *
 * Usage:
 *   node scripts/docs/check-citations.mjs [--page <name>] [--json]
 *
 * pdftotext (poppler) is used via child_process for .pdf extraction; .html
 * sources are tag-stripped, .md/other sources are read raw. PDF extractions
 * are cached under os.tmpdir() keyed by file path + size + mtime.
 */

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const MARKER_TITLE = 'Needs confirmation: source not held in full text';
const CACHE_DIR = path.join(tmpdir(), 'gc-curriculum-citation-check-cache');

// ---------------------------------------------------------------------------
// Text normalization + quote matching
// ---------------------------------------------------------------------------

/** Normalize text for robust substring comparison: NFKC, curly->straight
 * quotes, unify dashes, expand common ligatures, de-hyphenate line-break
 * hyphens, strip "[p. N]"-style page markers, collapse whitespace. */
export function normalizeText(s) {
  if (!s) return '';
  let t = s.normalize('NFKC');
  // Curly quotes -> straight.
  t = t.replace(/[‘’‚‛′]/g, "'");
  t = t.replace(/[“”„‟″]/g, '"');
  // Dashes -> unified hyphen.
  t = t.replace(/[‐‑‒–—―−]/g, '-');
  // Common ligatures.
  t = t
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl');
  // De-hyphenate line-break hyphens: "exam-\nple" -> "example".
  t = t.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  // Then drop every remaining intra-word hyphen on both sides: line-break
  // de-hyphenation can't tell "exam-ple" from a real "non-deterministic", so
  // compare hyphen-insensitively ("non-deterministic" == "nondeterministic").
  t = t.replace(/(\w)-(\w)/g, '$1$2');
  // Strip "[p. N]" / "[pp. N-M]" page markers.
  t = t.replace(/\[pp?\.?\s*\d+[–—-]?\d*\]/gi, '');
  // Collapse whitespace (including newlines) to single spaces.
  t = t.replace(/\s+/g, ' ').trim();
  return t.toLowerCase();
}

/** Split a quote on an ellipsis ("…" or "...") into fragments. Fragments
 * shorter than 12 characters (after normalization) are dropped — too short
 * to be a meaningful independent match. */
export function splitQuoteFragments(quote) {
  const parts = quote.split(/…|\.\.\./g).map(p => p.trim()).filter(Boolean);
  return parts.filter(p => normalizeText(p).length >= 12);
}

/** True if every fragment of `quote` (split on ellipsis, length >= 12 after
 * normalization) occurs as a substring of `sourceText`. Both sides are
 * normalized identically. An empty fragment list (e.g. the whole quote is
 * short) falls back to checking the whole normalized quote as one fragment. */
export function quoteMatches(sourceText, quote) {
  const normSource = normalizeText(sourceText);
  let fragments = splitQuoteFragments(quote);
  if (fragments.length === 0) fragments = [quote];
  return fragments.every(f => normSource.includes(normalizeText(f)));
}

// ---------------------------------------------------------------------------
// File resolution + text extraction
// ---------------------------------------------------------------------------

function expandHome(p) {
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

/** Resolve a "pdfs:<rel>" / "ai_career:<rel>" spec against held.json's roots
 * to an absolute path. `roots` values may themselves start with "~". */
export function resolveHeldFile(spec, roots) {
  const idx = spec.indexOf(':');
  if (idx === -1) throw new Error(`bad held-file spec (expected "<root>:<path>"): ${spec}`);
  const rootKey = spec.slice(0, idx);
  const rel = spec.slice(idx + 1);
  const rootDir = roots[rootKey];
  if (!rootDir) throw new Error(`unknown root "${rootKey}" in spec ${spec}`);
  const rootAbs = expandHome(rootDir).startsWith('/') || expandHome(rootDir).startsWith(homedir())
    ? expandHome(rootDir)
    : path.join(REPO_ROOT, expandHome(rootDir));
  return path.join(rootAbs, rel);
}

function cacheKeyFor(absPath) {
  const st = statSync(absPath);
  const h = crypto.createHash('sha1').update(absPath).update(String(st.size)).update(String(st.mtimeMs)).digest('hex');
  return h;
}

function stripHtmlTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** Extract plain text from a held source file. .pdf -> pdftotext (cached
 * under os.tmpdir()); .html -> tag-stripped; anything else (.md, .csv, ...)
 * -> read raw. Returns '' if the file can't be read/extracted (e.g. a .zip,
 * or a scanned PDF with no text layer) rather than throwing, so callers can
 * decide how to treat "no text available". */
export function extractText(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.pdf') {
    let key;
    try {
      key = cacheKeyFor(absPath);
    } catch {
      return '';
    }
    const cacheFile = path.join(CACHE_DIR, key + '.v2.txt');
    if (existsSync(cacheFile)) {
      return readFileSync(cacheFile, 'utf8');
    }
    // Two pdftotext modes (reading order differs on multi-column layouts),
    // plus a sibling OCR/markdown extraction (<stem>.md) when one exists —
    // scanned PDFs often have a poor or missing text layer.
    const parts = [];
    for (const args of [[absPath, '-'], ['-raw', absPath, '-']]) {
      const result = spawnSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
      if (result.status === 0 && result.stdout) parts.push(result.stdout);
    }
    const sidecar = absPath.slice(0, -ext.length) + '.md';
    if (existsSync(sidecar)) {
      try {
        parts.push(readFileSync(sidecar, 'utf8'));
      } catch {
        // Unreadable sidecar: fall back to the pdftotext text alone.
      }
    }
    const text = parts.join('\n\n');
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, text, 'utf8');
    } catch {
      // Cache is best-effort; ignore failures (e.g. read-only tmpdir).
    }
    return text;
  }
  if (ext === '.html' || ext === '.htm') {
    try {
      return stripHtmlTags(readFileSync(absPath, 'utf8'));
    } catch {
      return '';
    }
  }
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Reference-list <li> extraction
// ---------------------------------------------------------------------------

/** Extract the <li>...</li> entries inside a page's `<section id="references">`
 * block, if one exists. Returns [] if the page has no such section (e.g. a
 * page whose citations are inline prose rather than a bibliography list —
 * there is nothing at the <li> level to check). */
export function parseReferenceLis(html) {
  const secMatch = html.match(/<section id="references">([\s\S]*?)<\/section>/);
  if (!secMatch) return [];
  const sec = secMatch[1];
  const lis = [...sec.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)];
  return lis.map(([, attrs, content]) => {
    const idMatch = attrs.match(/id="([^"]*)"/);
    return {
      id: idMatch ? idMatch[1] : null,
      hasMarker: content.includes(MARKER_TITLE),
      text: stripHtmlTags(content).replace(/\s+/g, ' ').trim(),
    };
  });
}

/** Count "needs confirmation" marker occurrences anywhere on the page
 * (not just inside the reference list) — this is a whole-page report figure. */
export function countMarkers(html) {
  return (html.match(new RegExp(MARKER_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

// ---------------------------------------------------------------------------
// Per-page check
// ---------------------------------------------------------------------------

function loadHeldJson(heldJsonPath) {
  return JSON.parse(readFileSync(heldJsonPath, 'utf8'));
}

function pageBasenameNoExt(pageName) {
  return pageName.replace(/\.html?$/i, '');
}

/**
 * Run both checks for one page.
 * @param {string} pageName e.g. "background.html"
 * @param {object} held parsed held.json
 * @param {string} docsDir directory containing the page HTML files
 * @param {string} ledgersDir directory containing ledger JSON files
 */
export function checkPage(pageName, held, docsDir, ledgersDir) {
  const errors = [];
  const notes = [];

  const pagePath = path.join(docsDir, pageName);
  let html;
  try {
    html = readFileSync(pagePath, 'utf8');
  } catch (e) {
    errors.push(`${pageName}: cannot read page file (${e.message})`);
    return { errors, notes, markerCount: 0, ledgerCoverage: null };
  }

  const pageHeld = held.pages?.[pageName] ?? {};
  const lis = parseReferenceLis(html);

  // (a) every reference-list <li> either carries the marker, or maps to an
  // existing held file.
  for (const li of lis) {
    if (li.hasMarker) continue;
    const entry = li.id ? pageHeld[li.id] : undefined;
    if (!entry) {
      errors.push(
        `${pageName} ${li.id ?? '(no id)'}: not marked and not in held.json — ${li.text.slice(0, 80)}`
      );
      continue;
    }
    let abs;
    try {
      abs = resolveHeldFile(entry.file, held.roots);
    } catch (e) {
      errors.push(`${pageName} ${li.id}: ${e.message}`);
      continue;
    }
    if (!existsSync(abs)) {
      errors.push(`${pageName} ${li.id}: held.json maps to ${entry.file} but ${abs} does not exist`);
    }
  }

  const markerCount = countMarkers(html);

  // (b) ledger quote check.
  // Ledgers are flat: a page in a docs subdirectory (e.g.
  // "superpowers/vision/gc-curriculum-tool-vision.html") uses
  // ledgers/<basename>.json.
  const ledgerPath = path.join(ledgersDir, path.basename(pageBasenameNoExt(pageName)) + '.json');
  let ledgerCoverage = null;
  if (!existsSync(ledgerPath)) {
    notes.push(`${pageName}: no ledger at ${path.relative(REPO_ROOT, ledgerPath)} (note, not an error)`);
  } else {
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    } catch (e) {
      errors.push(`${pageName}: ledger ${ledgerPath} is not valid JSON (${e.message})`);
      ledger = null;
    }
    if (ledger) {
      const claims = ledger.claims ?? [];
      let ok = 0;
      for (const claim of claims) {
        let abs;
        try {
          abs = resolveHeldFile(claim.held_file, held.roots);
        } catch (e) {
          errors.push(`${pageName} ledger claim ${claim.id}: ${e.message}`);
          continue;
        }
        if (!existsSync(abs)) {
          errors.push(`${pageName} ledger claim ${claim.id}: held_file ${claim.held_file} -> ${abs} does not exist`);
          continue;
        }
        const sourceText = extractText(abs);
        if (quoteMatches(sourceText, claim.quote)) {
          ok++;
        } else {
          errors.push(
            `${pageName} ledger claim ${claim.id} (${claim.held_file}): quote not found — "${String(claim.quote).slice(0, 100)}"`
          );
        }
      }
      ledgerCoverage = { total: claims.length, ok, failed: claims.length - ok };
    }
  }

  return { errors, notes, markerCount, ledgerCoverage };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { page: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--page') args.page = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

export function runCheck({ page = null, held, docsDir, ledgersDir } = {}) {
  const pageNames = page ? [page] : Object.keys(held.pages ?? {});
  const results = {};
  let anyErrors = false;
  for (const pageName of pageNames) {
    const r = checkPage(pageName, held, docsDir, ledgersDir);
    results[pageName] = r;
    if (r.errors.length) anyErrors = true;
  }
  return { results, anyErrors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const docsDir = path.join(REPO_ROOT, 'docs');
  const ledgersDir = path.join(REPO_ROOT, 'docs', 'references', 'ledgers');
  const heldJsonPath = path.join(REPO_ROOT, 'docs', 'references', 'held.json');

  if (!existsSync(heldJsonPath)) {
    console.error(`held.json not found at ${heldJsonPath}`);
    process.exit(1);
  }
  const held = loadHeldJson(heldJsonPath);

  const { results, anyErrors } = runCheck({ page: args.page, held, docsDir, ledgersDir });

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const [pageName, r] of Object.entries(results)) {
      console.log(`\n=== ${pageName} ===`);
      console.log(`needs-confirmation markers: ${r.markerCount}`);
      if (r.ledgerCoverage) {
        console.log(`ledger coverage: ${r.ledgerCoverage.ok}/${r.ledgerCoverage.total} claims verified`);
      } else {
        console.log('ledger coverage: n/a');
      }
      if (r.notes.length) {
        console.log('Notes:');
        r.notes.forEach(n => console.log('  - ' + n));
      }
      if (r.errors.length) {
        console.log(`ERRORS (${r.errors.length}):`);
        r.errors.forEach(e => console.log('  ! ' + e));
      } else {
        console.log('No errors.');
      }
    }
  }

  process.exit(anyErrors ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
