import { describe, it, expect } from 'vitest';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';

const TWO_ROW_HEADER = `"Course Code","GC 3460"
"Title","Ink and Substrates"
"Level","3"
"Track","Core"
"Syllabus URL","https://example.com/gc-3460"
"Prerequisites","GC 2070"
"Description","Substrates and inks for graphic arts."
"Learning Objectives",""
"","Identify substrate categories."
"","Specify inks for a given substrate."
"Major Projects",""
"","Final project: substrate-ink compatibility matrix."
"Skills/Competencies Required",""
"","Comfort with chemistry fundamentals."
"","Basic measurement and lab safety."
`;

describe('parseCourseTab', () => {
  it('parses a standard two-row-header tab', () => {
    const r = parseCourseTab(TWO_ROW_HEADER);
    expect(r.code).toBe('GC 3460');
    expect(r.title).toBe('Ink and Substrates');
    expect(r.level).toBe(3);
    expect(r.track).toBe('Core');
    expect(r.syllabusUrl).toBe('https://example.com/gc-3460');
    expect(r.prerequisites).toBe('GC 2070');
    expect(r.description).toContain('Substrates');
    expect(r.learningObjectives).toEqual([
      'Identify substrate categories.',
      'Specify inks for a given substrate.',
    ]);
    expect(r.majorProjects).toEqual([
      'Final project: substrate-ink compatibility matrix.',
    ]);
    expect(r.skillsRequired).toEqual([
      'Comfort with chemistry fundamentals.',
      'Basic measurement and lab safety.',
    ]);
  });

  it('handles gviz-collapsed first row "Course Code Title"', () => {
    const collapsed = `"Course Code Title","GC 4900ap Special Topics: Analog Photography"
"Level","4"
"Track","Special Topics"
"Syllabus URL",""
"Prerequisites",""
"Description","x"
"Learning Objectives",""
"","obj 1"
"Major Projects",""
"Skills/Competencies Required",""
`;
    const r = parseCourseTab(collapsed);
    expect(r.code).toBe('GC 4900ap');
    expect(r.title).toBe('Special Topics: Analog Photography');
    expect(r.majorProjects).toEqual([]);
    expect(r.syllabusUrl).toBeNull();
  });

  it('treats unrecognized rows as no-ops, not errors', () => {
    const r = parseCourseTab(`"Course Code","GC 1010"
"Title","Orientation"
"Level","1"
"Track","Core"
"Description","x"
"Some Future Field","ignore me"
`);
    expect(r.code).toBe('GC 1010');
    expect(r.learningObjectives).toEqual([]);
  });

  it('throws if code or title is missing', () => {
    expect(() => parseCourseTab(`"Level","1"\n"Title","x"\n`)).toThrow(/code/i);
    expect(() => parseCourseTab(`"Course Code","GC 1010"\n"Level","1"\n`)).toThrow(/title/i);
  });
});
