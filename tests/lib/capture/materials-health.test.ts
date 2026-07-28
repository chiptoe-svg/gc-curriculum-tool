import { describe, it, expect } from 'vitest';
import { assessMaterialsHealth } from '@/lib/capture/materials-health';

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
