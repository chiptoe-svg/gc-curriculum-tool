import { describe, it, expect } from 'vitest';
import {
  materialProvenance,
  PROVENANCE_LABEL,
  indexingStatusLabel,
  hasMaterials,
  shouldShowMaterialsStep,
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
