import { describe, it, expect } from 'vitest';
import { MATERIAL_UPLOAD_ACCEPT, isUploadableMaterial, UPLOADABLE_KINDS } from '@/lib/courses/upload-types';
import { SUPPORTED_MIME_TYPES } from '@/lib/courses/material-extractor';

/** The pickers offered only PDF and DOCX although the server reads CSV, Excel,
 *  PowerPoint, HTML and images too (owner, 2026-10-28: a Canvas rubric export
 *  is a CSV). The pickers now offer everything the server reads. */
describe('material upload types', () => {
  it('accepts every type the server can read', () => {
    for (const type of SUPPORTED_MIME_TYPES) {
      expect(isUploadableMaterial({ type, name: 'x' }), type).toBe(true);
    }
  });
  it('accepts a CSV rubric export and a spreadsheet', () => {
    expect(isUploadableMaterial({ type: 'text/csv', name: 'rubric.csv' })).toBe(true);
    expect(isUploadableMaterial({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: 'grades.xlsx' })).toBe(true);
  });
  it('still refuses what the server cannot read', () => {
    expect(isUploadableMaterial({ type: 'application/zip', name: 'x.zip' })).toBe(false);
    expect(isUploadableMaterial({ type: 'video/mp4', name: 'x.mp4' })).toBe(false);
  });
  it('the picker offers the extensions', () => {
    for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.html', '.png', '.jpg', '.jpeg']) {
      expect(MATERIAL_UPLOAD_ACCEPT.split(',')).toContain(ext);
    }
  });
  it('names the kinds for the error message', () => {
    expect(UPLOADABLE_KINDS).toBe('PDF, Word, PowerPoint, Excel, CSV, HTML, PNG or JPEG');
  });
});
