import { describe, it, expect } from 'vitest';
import {
  classifySource,
  isCompressionCandidate,
  effectiveAuditText,
  type CompressionMaterial,
} from '@/lib/capture/material-compression';

const LONG = 'x'.repeat(60_001); // > 15k tokens (60_000 chars / 4)
const SHORT = 'x'.repeat(1_000);

function mat(overrides: Partial<CompressionMaterial>): CompressionMaterial {
  return {
    fileName: 'Drive PDF: foo.pdf',
    extractedText: LONG,
    digest: null,
    useDigest: false,
    ...overrides,
  };
}

describe('classifySource', () => {
  it('recognizes Canvas dense kinds', () => {
    expect(classifySource('Canvas: Syllabus')).toBe('canvas_dense');
    expect(classifySource('Canvas: Assignments')).toBe('canvas_dense');
  });
  it('recognizes Canvas File attachments separately', () => {
    expect(classifySource('Canvas File: chapter-3.pdf')).toBe('canvas_file');
  });
  it('recognizes Google Workspace kinds', () => {
    expect(classifySource('Google Doc: rubric')).toBe('google_workspace');
    expect(classifySource('Google Slides: deck')).toBe('google_workspace');
    expect(classifySource('Google Sheet: schedule')).toBe('google_workspace');
  });
  it('recognizes Drive PDF and YouTube', () => {
    expect(classifySource('Drive PDF: chapter.pdf')).toBe('drive_pdf');
    expect(classifySource('YouTube: lecture')).toBe('youtube');
  });
  it('falls back to uploaded for everything else', () => {
    expect(classifySource('whatever.pdf')).toBe('uploaded');
  });
});

describe('isCompressionCandidate', () => {
  it('returns true for long Drive PDFs', () => {
    expect(isCompressionCandidate(mat({}))).toBe(true);
  });
  it('returns true for long YouTube transcripts', () => {
    expect(isCompressionCandidate(mat({ fileName: 'YouTube: foo' }))).toBe(true);
  });
  it('returns true for long Canvas File attachments', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Canvas File: foo.pdf' }))).toBe(true);
  });
  it('returns true for long plain uploads', () => {
    expect(isCompressionCandidate(mat({ fileName: 'random.pdf' }))).toBe(true);
  });
  it('returns false for short materials regardless of kind', () => {
    expect(isCompressionCandidate(mat({ extractedText: SHORT }))).toBe(false);
  });
  it('returns false for Canvas dense materials even if long', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Canvas: Pages' }))).toBe(false);
  });
  it('returns false for Google Workspace materials even if long', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Google Doc: huge' }))).toBe(false);
  });
  it('returns false when extractedText is null', () => {
    expect(isCompressionCandidate(mat({ extractedText: null }))).toBe(false);
  });
});

describe('effectiveAuditText', () => {
  it('uses digest when useDigest=true and digest is non-null', () => {
    const m = mat({ digest: 'DIGEST', useDigest: true });
    expect(effectiveAuditText(m)).toBe('DIGEST');
  });
  it('uses extractedText when useDigest=false', () => {
    const m = mat({ digest: 'DIGEST', useDigest: false });
    expect(effectiveAuditText(m)).toBe(LONG);
  });
  it('uses extractedText when useDigest=true but digest is null', () => {
    const m = mat({ digest: null, useDigest: true });
    expect(effectiveAuditText(m)).toBe(LONG);
  });
  it('returns null when both are null', () => {
    expect(effectiveAuditText(mat({ extractedText: null, digest: null, useDigest: true }))).toBe(null);
  });
});
