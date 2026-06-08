import { describe, it, expect } from 'vitest';
import { mergeCourseInfo, type CourseDbRow, type CourseInfoExtended } from '@/lib/ai/wiki/update';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';

// mergeCourseInfo is a named export of the pure merge function (no I/O).

const dbRow: CourseDbRow = {
  title: 'Color Science',
  level: 3460,
  prerequisites: 'GC 1010, GC 2050',
};

const sheetData: ParsedCourse = {
  code: 'GC 3460',
  title: 'Color Science & Management',
  level: 3460,
  track: 'Production',
  description: 'Studio-intensive course covering press-floor color science.',
  prerequisites: 'GC 1010',
  syllabusUrl: 'https://example.com/gc3460-syllabus.pdf',
  learningObjectives: ['Operate spectrophotometers', 'Generate ICC profiles'],
  majorProjects: ['Brand Color Report', 'Press Check Portfolio'],
  skillsRequired: ['Basic color theory'],
};

describe('mergeCourseInfo', () => {
  it('sheet title takes precedence over DB title', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.title).toBe('Color Science & Management');
  });

  it('sheet description populates sheetDescription', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetDescription).toBe('Studio-intensive course covering press-floor color science.');
  });

  it('sheet majorProjects populates sheetMajorProjects', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetMajorProjects).toEqual(['Brand Color Report', 'Press Check Portfolio']);
  });

  it('sheet learningObjectives populates sheetLearningObjectives', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetLearningObjectives).toEqual(['Operate spectrophotometers', 'Generate ICC profiles']);
  });

  it('syllabusUrl comes from sheet', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.syllabusUrl).toBe('https://example.com/gc3460-syllabus.pdf');
  });

  it('sheetSourceUrl is set when sheetData is provided and GOOGLE_SHEET_ID is set', () => {
    process.env.GOOGLE_SHEET_ID = 'ABC123';
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetSourceUrl).toBe('https://docs.google.com/spreadsheets/d/ABC123');
    delete process.env.GOOGLE_SHEET_ID;
  });

  it('falls back to DB title when sheetData is null', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.title).toBe('Color Science');
  });

  it('all sheet-derived fields are null/empty when sheetData is null', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.sheetDescription).toBeNull();
    expect(info.sheetMajorProjects).toEqual([]);
    expect(info.sheetLearningObjectives).toEqual([]);
    expect(info.sheetSkillsRequired).toEqual([]);
    expect(info.syllabusUrl).toBeNull();
    expect(info.sheetSourceUrl).toBeNull();
  });

  it('prerequisites are normalized from comma-separated string', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.prerequisites).toEqual(['gc-1010', 'gc-2050']);
  });

  it('prerequisites from DB array are preserved as slugs', () => {
    const info = mergeCourseInfo({ ...dbRow, prerequisites: ['GC 1010', 'GC 2050'] as unknown as string }, null);
    expect(info.prerequisites).toEqual(['gc-1010', 'gc-2050']);
  });
});
