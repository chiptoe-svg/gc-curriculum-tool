import { describe, it, expect } from 'vitest';
import { evaluateMaterialsPolicy, type PolicyInput } from '@/lib/capture/materials-policy';

const base: Omit<PolicyInput, 'fileName'> = {
  extractedText: 'a non-empty body of text',
  courseHasLearningObjectives: false,
};

describe('evaluateMaterialsPolicy', () => {
  it('sets aside Canvas: Syllabus when the course already has LOs', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas: Syllabus', courseHasLearningObjectives: true });
    expect(r.included).toBe(false);
    expect(r.ferpaRisk).toBe('low');
    expect(r.reason).toMatch(/Sheets has LOs/i);
    expect(r.overridable).toBe(true);
  });

  it('keeps Canvas: Syllabus when the course has no LOs', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas: Syllabus', courseHasLearningObjectives: false });
    expect(r.included).toBe(true);
  });

  it('sets aside empty/malformed Google Sheet imports', () => {
    const r = evaluateMaterialsPolicy({
      ...base,
      fileName: 'Google Sheet: Project schedule',
      extractedText: ',,,\n,,,\n,,,',
    });
    expect(r.included).toBe(false);
    expect(r.reason).toMatch(/empty or malformed/i);
  });

  it('keeps Google Sheets with substantive content', () => {
    const r = evaluateMaterialsPolicy({
      ...base,
      fileName: 'Google Sheet: KUDs',
      extractedText: 'Know: color theory\nUnderstand: ΔE\nDo: calibrate the press',
    });
    expect(r.included).toBe(true);
  });

  it('sets aside Canvas File: *.xlsx and *.xls', () => {
    const xlsx = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: grades.xlsx' });
    expect(xlsx.included).toBe(false);
    expect(xlsx.reason).toMatch(/spreadsheet/i);
    const xls = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: roster.xls' });
    expect(xls.included).toBe(false);
  });

  it('marks Canvas: Discussions as high FERPA risk and sets it aside', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas: Discussions' });
    expect(r.included).toBe(false);
    expect(r.ferpaRisk).toBe('high');
    expect(r.reason).toMatch(/student posts/i);
  });

  it('includes everything else with low risk', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: textbook.pdf' });
    expect(r.included).toBe(true);
    expect(r.ferpaRisk).toBe('low');
  });

  it('returns overridable: true on every decision', () => {
    for (const fileName of [
      'Canvas: Syllabus',
      'Canvas: Discussions',
      'Canvas File: grades.xlsx',
      'Canvas File: textbook.pdf',
    ]) {
      expect(evaluateMaterialsPolicy({ ...base, fileName, courseHasLearningObjectives: true }).overridable).toBe(true);
    }
  });
});
