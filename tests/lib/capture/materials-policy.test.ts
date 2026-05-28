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

  it('sets aside Canvas File: *.xlsx and *.xls (legacy case, kept for reference)', () => {
    // Both are gradebook-shaped, so still excluded under the new narrow rule.
    const xlsx = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: grades.xlsx' });
    expect(xlsx.included).toBe(false);
    const xls = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: roster.xls' });
    expect(xls.included).toBe(false);
  });

  describe('xlsx policy', () => {
    it('includes a generic Canvas File xlsx by default', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: 4800_budget_2025.xlsx' });
      expect(result.included).toBe(true);
    });

    it('includes a Canvas File xlsx with project-template-shaped name', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Project_Scope_Template.xlsx' });
      expect(result.included).toBe(true);
    });

    it('excludes a Canvas File xlsx with gradebook-shaped name', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Gradebook_Spring_2025.xlsx' });
      expect(result.included).toBe(false);
      expect(result.reason).toMatch(/grade/i);
    });

    it('excludes a Canvas File xlsx with attendance-shaped name', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Attendance_Log.xlsx' });
      expect(result.included).toBe(false);
    });

    it('excludes a Canvas File xlsx with roster-shaped name', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Class_Roster_F25.xlsx' });
      expect(result.included).toBe(false);
    });

    it('excludes a Canvas File xlsx with scores-suffix name', () => {
      const result = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Final_Project_Scores.xlsx' });
      expect(result.included).toBe(false);
    });

    it('applies the same logic to .xls and .xlsm files', () => {
      expect(evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Budget_Legacy.xls' }).included).toBe(true);
      expect(evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Gradebook_2020.xls' }).included).toBe(false);
      expect(evaluateMaterialsPolicy({ ...base, fileName: 'Canvas File: Budget_With_Macros.xlsm' }).included).toBe(true);
    });
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
