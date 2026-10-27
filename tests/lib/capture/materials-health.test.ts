import { describe, it, expect } from 'vitest';
import { assessMaterialsHealth, assessEvidence } from '@/lib/capture/materials-health';

const m = (fileName: string, extractionStatus: string, ignored = false) => ({ fileName, extractionStatus, ignored });

describe('assessMaterialsHealth', () => {
  it('reports none when everything extracted', () => {
    const h = assessMaterialsHealth([m('a.pdf', 'ready'), m('b.pdf', 'ready')]);
    expect(h).toEqual({ total: 2, failedExtraction: 0, failedFiles: [], severity: 'none' });
  });

  it('flags SEVERE at the GC 3620 shape (14 of 18 failed)', () => {
    const mats = [
      ...Array.from({ length: 14 }, (_, i) => m(`deck${i}.pdf`, 'failed')),
      ...Array.from({ length: 4 }, (_, i) => m(`ok${i}.html`, 'ready')),
    ];
    const h = assessMaterialsHealth(mats);
    expect(h.failedExtraction).toBe(14);
    expect(h.total).toBe(18);
    expect(h.severity).toBe('severe');
    expect(h.failedFiles).toContain('deck0.pdf');
  });

  it('notice (not severe) for a single failure among many', () => {
    const mats = [m('bad.pdf', 'failed'), ...Array.from({ length: 9 }, (_, i) => m(`ok${i}.pdf`, 'ready'))];
    const h = assessMaterialsHealth(mats);
    expect(h.failedExtraction).toBe(1);
    expect(h.severity).toBe('notice'); // 1/10 = 10%, below the 30% / 5-file severe bar
  });

  it('severe when >=5 failed even if ratio is under 30%', () => {
    const mats = [
      ...Array.from({ length: 5 }, (_, i) => m(`bad${i}.pdf`, 'failed')),
      ...Array.from({ length: 15 }, (_, i) => m(`ok${i}.pdf`, 'ready')),
    ];
    expect(assessMaterialsHealth(mats).severity).toBe('severe'); // 5/20 = 25% but >=5 files
  });

  it('excludes ignored materials from the count', () => {
    const h = assessMaterialsHealth([m('bad.pdf', 'failed', true), m('a.pdf', 'ready')]);
    expect(h.failedExtraction).toBe(0);
    expect(h.total).toBe(1);
    expect(h.severity).toBe('none');
  });

  it('does NOT count unfetched linked-external breadcrumbs as failed extraction', () => {
    // Drive PDF:/YouTube: with status 'failed' are intentional "reference exists but we
    // could not fetch it" breadcrumbs — not failed extractions of provided content.
    const mats = [
      m('Drive PDF: 1abc… (unsupported type)', 'failed'),
      m('YouTube: Some video (inaccessible)', 'failed'),
      m('a.pdf', 'ready'),
      m('b.pdf', 'ready'),
    ];
    const h = assessMaterialsHealth(mats);
    expect(h.failedExtraction).toBe(0);
    expect(h.total).toBe(2); // breadcrumbs excluded from the calculus entirely
    expect(h.severity).toBe('none');
  });

  it('still counts a genuinely failed uploaded/canvas material alongside linked breadcrumbs', () => {
    const mats = [
      m('Drive PDF: 1abc… (not accessible)', 'failed'), // excluded
      m('Canvas File: real-deck.pdf', 'failed'), // counted
      m('a.pdf', 'ready'),
    ];
    const h = assessMaterialsHealth(mats);
    expect(h.failedExtraction).toBe(1);
    expect(h.failedFiles).toEqual(['Canvas File: real-deck.pdf']);
    expect(h.total).toBe(2);
  });
});

// Thin-evidence check (owner, 2026-10-27): GC 4400 was captured from a syllabus
// alone, with two uploads never read and nothing from Canvas — warn, don't block.
describe('assessEvidence', () => {
  const mat = (fileName: string, indexingStatus: string, extra: Record<string, unknown> = {}) =>
    ({ fileName, indexingStatus, extractionStatus: indexingStatus === 'ready' ? 'ok' : 'pending', ignored: false, retiredAt: null, isSyllabus: false, ...extra });
  const syllabus = mat('4400_6400 Syllabus Fall 2026.pdf', 'ready', { isSyllabus: true });

  it('warns at the GC 4400 shape: syllabus only, two unread uploads, no Canvas', () => {
    const e = assessEvidence([syllabus, mat('Photo Book Assignment.docx', 'pending'), mat('Photo Book Assignment.docx', 'pending')]);
    expect(e).toEqual({ warn: true, unreadFiles: ['Photo Book Assignment.docx', 'Photo Book Assignment.docx'], onlySyllabus: true, noCanvas: true });
  });

  it('counts queued, in-progress and failed files as unread', () => {
    const e = assessEvidence([syllabus, mat('a.pdf', 'queued'), mat('b.pdf', 'indexing'), mat('c.pdf', 'failed'), mat('Canvas: Assignments', 'ready')]);
    expect(e.unreadFiles).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(e.warn).toBe(true);
    expect(e.onlySyllabus).toBe(false);
  });

  it('does not warn when Canvas content has been read and nothing is waiting', () => {
    const e = assessEvidence([syllabus, mat('Canvas: Assignments', 'ready'), mat('Canvas File: rubric.pdf', 'skipped')]);
    expect(e).toEqual({ warn: false, unreadFiles: [], onlySyllabus: false, noCanvas: false });
  });

  it('a read upload counts as evidence even without Canvas', () => {
    const e = assessEvidence([syllabus, mat('Project brief.docx', 'ready')]);
    expect(e).toEqual({ warn: false, unreadFiles: [], onlySyllabus: false, noCanvas: true });
  });

  it('the generated catalog syllabus is not evidence', () => {
    expect(assessEvidence([mat('Catalog syllabus (generated from the GC course sheet)', 'ready')]).onlySyllabus).toBe(true);
  });

  it('a set-aside file is read but is not evidence', () => {
    expect(assessEvidence([syllabus, mat('roster.pdf', 'skipped')]).onlySyllabus).toBe(true);
  });

  it('ignores ignored and retired files and unfetched linked references', () => {
    const e = assessEvidence([
      syllabus, mat('Canvas: Pages', 'ready'),
      mat('old.pdf', 'pending', { ignored: true }),
      mat('gone.pdf', 'failed', { retiredAt: '2026-10-01T00:00:00Z' }),
      mat('YouTube: Some video', 'failed', { extractionStatus: 'failed' }),
    ]);
    expect(e.warn).toBe(false);
    expect(e.unreadFiles).toEqual([]);
  });

  it('an empty course warns as syllabus-only', () => {
    expect(assessEvidence([])).toEqual({ warn: true, unreadFiles: [], onlySyllabus: true, noCanvas: true });
  });
});
