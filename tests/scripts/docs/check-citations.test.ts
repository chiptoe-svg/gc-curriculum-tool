/**
 * Tests for the pre-publish citation check (scripts/docs/check-citations.mjs).
 * Uses small hand-built fixtures under tests/fixtures/check-citations/ —
 * never the real git-ignored PDFs in docs/references/_pdfs/.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  normalizeText,
  splitQuoteFragments,
  quoteMatches,
  parseReferenceLis,
  countMarkers,
  checkPage,
} from '@/scripts/docs/check-citations.mjs';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/check-citations');
const DOCS_DIR = path.join(FIXTURES, 'pages');
const LEDGERS_DIR = path.join(FIXTURES, 'ledgers');
const HELD_ROOT = path.join(FIXTURES, 'held-root');

function heldJsonFor(pages) {
  return {
    version: 1,
    roots: { fixture: HELD_ROOT },
    pages,
  };
}

describe('normalizeText', () => {
  it('unifies curly quotes to straight quotes', () => {
    expect(normalizeText('“hello” and ‘world’')).toBe('"hello" and \'world\'');
  });

  it('de-hyphenates a line-break hyphen', () => {
    expect(normalizeText('condi-\ntions')).toBe('conditions');
  });

  it('unifies en/em dashes to a plain hyphen', () => {
    expect(normalizeText('pp. 10–20')).toContain('10-20');
  });

  it('strips "[p. N]" page markers', () => {
    expect(normalizeText('the result [p. 4] stands')).toBe('the result stands');
  });

  it('collapses whitespace and lowercases', () => {
    expect(normalizeText('  Multiple   Spaces\nAnd\tTabs  ')).toBe('multiple spaces and tabs');
  });
});

describe('splitQuoteFragments / quoteMatches', () => {
  it('splits an ellipsis-joined quote into independently-checked fragments', () => {
    const fragments = splitQuoteFragments('first clause here … second clause there');
    expect(fragments).toEqual(['first clause here', 'second clause there']);
  });

  it('drops fragments shorter than 12 characters after normalization', () => {
    const fragments = splitQuoteFragments('a long enough fragment … hi');
    expect(fragments).toEqual(['a long enough fragment']);
  });

  it('matches a quote whose fragments are found (out of order in the quote vs. source) once both sides are normalized', () => {
    const source = 'The study found that “the effect is large” and later “replicates widely” across sites.';
    expect(quoteMatches(source, 'the effect is large … replicates widely')).toBe(true);
  });

  it('fails when a fragment is not present in the source', () => {
    const source = 'The study found that the effect is large across sites.';
    expect(quoteMatches(source, 'the effect is large … this part is not in the source')).toBe(false);
  });
});

describe('parseReferenceLis / countMarkers', () => {
  it('extracts id, marker presence, and text for each reference-list <li>', () => {
    const html = `
      <section id="references">
        <ol class="refs">
          <li id="ref-a"><sup class="nv" title="Needs confirmation: source not held in full text">&dagger;</sup> A, A. (2020). Title.</li>
          <li id="ref-b">B, B. (2021). Title.</li>
        </ol>
      </section>`;
    const lis = parseReferenceLis(html);
    expect(lis).toHaveLength(2);
    expect(lis[0]).toMatchObject({ id: 'ref-a', hasMarker: true });
    expect(lis[1]).toMatchObject({ id: 'ref-b', hasMarker: false });
  });

  it('returns [] for a page with no <section id="references">', () => {
    expect(parseReferenceLis('<html><body><p>no refs here</p></body></html>')).toEqual([]);
  });

  it('counts marker occurrences anywhere on the page', () => {
    const html = 'x'.repeat(5) + '<sup class="nv" title="Needs confirmation: source not held in full text">&dagger;</sup>'.repeat(3);
    expect(countMarkers(html)).toBe(3);
  });
});

describe('checkPage', () => {
  it('passes a marked <li> even with no held.json entry', () => {
    const held = heldJsonFor({ 'no-ledger-page.html': {} });
    const r = checkPage('no-ledger-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.errors).toEqual([]);
  });

  it('errors on an unmarked <li> that is not in held.json', () => {
    const held = heldJsonFor({
      'sample-page.html': {
        'ref-held-2021': { file: 'fixture:held-2021-source.txt' },
        // ref-unheld-2022 deliberately omitted
      },
    });
    const r = checkPage('sample-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.errors.some(e => e.includes('ref-unheld-2022'))).toBe(true);
    expect(r.errors.some(e => e.includes('ref-held-2021'))).toBe(false);
    expect(r.errors.some(e => e.includes('ref-marked-2020'))).toBe(false);
  });

  it('errors when held.json maps to a file that does not exist on disk', () => {
    const held = heldJsonFor({
      'sample-page.html': {
        'ref-held-2021': { file: 'fixture:does-not-exist.txt' },
        'ref-unheld-2022': { file: 'fixture:held-2021-source.txt' },
      },
    });
    const r = checkPage('sample-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.errors.some(e => e.includes('ref-held-2021') && e.includes('does not exist'))).toBe(true);
  });

  it('reports a missing ledger as a note, not an error', () => {
    const held = heldJsonFor({ 'no-ledger-page.html': {} });
    const r = checkPage('no-ledger-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.errors).toEqual([]);
    expect(r.notes.some(n => n.includes('no ledger'))).toBe(true);
    expect(r.ledgerCoverage).toBeNull();
  });

  it('verifies a ledger quote (with curly quotes + ellipsis fragments) against the held source, and errors on one that is not found', () => {
    const held = heldJsonFor({
      'sample-page.html': {
        'ref-held-2021': { file: 'fixture:held-2021-source.txt' },
        'ref-unheld-2022': { file: 'fixture:held-2021-source.txt' },
      },
    });
    const r = checkPage('sample-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.ledgerCoverage).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(r.errors.some(e => e.includes('claim-2-missing'))).toBe(true);
    expect(r.errors.some(e => e.includes('claim-1'))).toBe(false);
  });

  it('reports the needs-confirmation marker count for a page', () => {
    const held = heldJsonFor({ 'no-ledger-page.html': {} });
    const r = checkPage('no-ledger-page.html', held, DOCS_DIR, LEDGERS_DIR);
    expect(r.markerCount).toBe(1);
  });
});
