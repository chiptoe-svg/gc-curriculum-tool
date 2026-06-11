import { describe, it, expect } from 'vitest';
import {
  materialProvenance,
  PROVENANCE_LABEL,
  indexingStatusLabel,
  hasMaterials,
  shouldShowMaterialsStep,
} from '@/lib/capture/material-display';
import {
  catalogContributionSummary, materialReadability, relativeTimeFromNow, hasFixablyUnindexed,
} from '@/lib/capture/material-display';

describe('materialProvenance', () => {
  it('classifies Canvas list + Canvas File as canvas', () => {
    expect(materialProvenance({ fileName: 'Canvas: Syllabus' })).toBe('canvas');
    expect(materialProvenance({ fileName: 'Canvas File: rubric.pdf' })).toBe('canvas');
  });
  it('classifies Google/Drive/YouTube as linked', () => {
    for (const n of ['Google Doc: Brief', 'Google Slides: Deck', 'Google Sheet: Grades', 'Drive PDF: Spec', 'YouTube: Lecture 1']) {
      expect(materialProvenance({ fileName: n })).toBe('linked');
    }
  });
  it('classifies anything else as a local upload', () => {
    expect(materialProvenance({ fileName: 'GC3800_Syllabus.pdf' })).toBe('uploaded');
    expect(materialProvenance({ fileName: 'Project2_Brief.docx' })).toBe('uploaded');
  });
});

describe('PROVENANCE_LABEL', () => {
  it('has a human label per provenance', () => {
    expect(PROVENANCE_LABEL.canvas).toBe('Canvas');
    expect(PROVENANCE_LABEL.uploaded).toBe('uploaded');
    expect(PROVENANCE_LABEL.linked).toBe('linked doc');
  });
});

describe('indexingStatusLabel', () => {
  it('maps known statuses, defaults to pending', () => {
    expect(indexingStatusLabel('ready')).toBe('ready');
    expect(indexingStatusLabel('indexing')).toBe('indexing…');
    expect(indexingStatusLabel('failed')).toBe('failed');
    expect(indexingStatusLabel('skipped')).toBe('skipped');
    expect(indexingStatusLabel('weird-unknown')).toBe('pending');
  });
});

describe('hasMaterials', () => {
  it('is true only when count >= 1', () => {
    expect(hasMaterials(0)).toBe(false);
    expect(hasMaterials(1)).toBe(true);
    expect(hasMaterials(5)).toBe(true);
  });
});

describe('shouldShowMaterialsStep', () => {
  it('shows only on a fresh chat landing with landingStep=materials', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 0, landingStep: 'materials' })).toBe(true);
  });
  it('hides once advanced to interview', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 0, landingStep: 'interview' })).toBe(false);
  });
  it('hides when resuming (messages exist) or off the chat stage', () => {
    expect(shouldShowMaterialsStep({ stage: 'chat', messagesCount: 3, landingStep: 'materials' })).toBe(false);
    expect(shouldShowMaterialsStep({ stage: 'review', messagesCount: 0, landingStep: 'materials' })).toBe(false);
    expect(shouldShowMaterialsStep({ stage: 'generating', messagesCount: 0, landingStep: 'materials' })).toBe(false);
  });
});

describe('catalogContributionSummary', () => {
  it('lists only non-empty fields', () => {
    expect(catalogContributionSummary({ description: 'd', learningObjectives: ['a','b'], prerequisites: '', majorProjects: ['p'], skillsRequired: [] }))
      .toBe('description · 2 learning objectives · 1 major project');
  });
  it('falls back when everything is empty', () => {
    expect(catalogContributionSummary({ description: '', learningObjectives: [], prerequisites: '', majorProjects: [], skillsRequired: [] }))
      .toBe('no catalog details synced yet');
  });
});

describe('materialReadability', () => {
  it('marks ready readable', () => {
    expect(materialReadability({ indexingStatus: 'ready' })).toEqual({ readable: true, label: 'ready' });
  });
  it('marks pending not-readable', () => {
    expect(materialReadability({ indexingStatus: 'pending' })).toMatchObject({ readable: false, label: 'not indexed yet' });
  });
  it('explains skipped with a reason', () => {
    expect(materialReadability({ indexingStatus: 'skipped', setAsideReason: null }).reason).toMatch(/no extractable content/i);
    expect(materialReadability({ indexingStatus: 'skipped', setAsideReason: 'not shared' }).reason).toBe('not shared');
  });
  it('explains failed', () => {
    expect(materialReadability({ indexingStatus: 'failed' })).toMatchObject({ readable: false, reason: 'extraction failed' });
  });
});

describe('relativeTimeFromNow', () => {
  const now = 1_000_000_000_000;
  it('handles null + recency', () => {
    expect(relativeTimeFromNow(null, now)).toBe('not synced yet');
    expect(relativeTimeFromNow(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(relativeTimeFromNow(new Date(now - 5*60_000).toISOString(), now)).toBe('5m ago');
    expect(relativeTimeFromNow(new Date(now - 3*3_600_000).toISOString(), now)).toBe('3h ago');
    expect(relativeTimeFromNow(new Date(now - 2*86_400_000).toISOString(), now)).toBe('2d ago');
  });
});

describe('hasFixablyUnindexed', () => {
  it('true when a non-ignored pending/failed exists', () => {
    expect(hasFixablyUnindexed([{ indexingStatus: 'ready' }, { indexingStatus: 'pending' }])).toBe(true);
    expect(hasFixablyUnindexed([{ indexingStatus: 'pending', ignored: true }])).toBe(false);
    expect(hasFixablyUnindexed([{ indexingStatus: 'skipped' }, { indexingStatus: 'ready' }])).toBe(false);
  });
});
