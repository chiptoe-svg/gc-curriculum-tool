import { describe, it, expect } from 'vitest';
import {
  splitCourseBody, cleanProjectLinks, cleanSyllabus, cleanProjects, decodeEntities, guideSummary, courseLevelLabel, captureFact,
} from '@/lib/wiki/course-page';

const BODY = `Overview paragraph one.

Overview paragraph two.

## At a glance

- — **Course shape:** Project-heavy.
- **Plain:** fine.

## Who it's for

Incoming students.

## Competencies developed

### Technical competencies

- x — K3/U3/D4

## Syllabus

Course description here.

**Learning objectives:**

- Objective one.
- Objective two.

**Signature projects:** see [Signature projects](#signature-projects) above.

**Links:** [Syllabus PDF](https://x) · [Course sheet](https://y)

## Source snapshots

- [2026-06-01](raw/x.json)
`;

describe('splitCourseBody', () => {
  it('keeps the text before the first section as the intro and keys sections by heading', () => {
    const b = splitCourseBody(BODY);
    expect(b.intro).toBe('Overview paragraph one.\n\nOverview paragraph two.');
    expect(Object.keys(b.sections)).toEqual(['At a glance', "Who it's for", 'Competencies developed', 'Syllabus', 'Source snapshots']);
    expect(b.sections["Who it's for"]).toBe('Incoming students.');
    expect(b.sections['Competencies developed']).toContain('### Technical competencies');
  });

  it('removes the doubled list leader ("- — ") the generator sometimes writes', () => {
    expect(splitCourseBody(BODY).sections['At a glance']).toBe('- **Course shape:** Project-heavy.\n- **Plain:** fine.');
  });
});

describe('cleanSyllabus', () => {
  it('drops the objectives list and the "see above" line, keeps the description and links', () => {
    const s = cleanSyllabus(splitCourseBody(BODY).sections['Syllabus']!);
    expect(s).toContain('Course description here.');
    expect(s).toContain('[Syllabus PDF](https://x)');
    expect(s).not.toContain('Objective one');
    expect(s).not.toContain('Learning objectives');
    expect(s).not.toContain('see [Signature projects]');
  });
});

describe('cleanSyllabus with arrival skills shown elsewhere', () => {
  const SYL = 'Desc.\n\n**Skills students should arrive with:**\n\n- Prepress.\n- Writing.\n\n**Links:** [PDF](https://x)';
  it('drops the arrival-skills list when the page shows it in About', () => {
    const s = cleanSyllabus(SYL, { dropArrivalSkills: true });
    expect(s).not.toContain('Prepress');
    expect(s).not.toContain('arrive with');
    expect(s).toContain('[PDF](https://x)');
  });
  it('keeps it otherwise', () => {
    expect(cleanSyllabus(SYL)).toContain('Prepress');
  });
});

describe('cleanProjects', () => {
  it('drops the course-sheet fallback note', () => {
    expect(cleanProjects('*The following project list comes from the course sheet — not yet captured in a profile audit.*\n\n- Design Thinking Project (15%)')).toBe('- Design Thinking Project (15%)');
  });
});

describe('cleanProjectLinks', () => {
  const LINKS = `### Internship Fair

- Students gather employer information. — not yet linked to a catalog competency
- Agency
  - [[agency|Agency]] (K–/U–/D2) — closest O*NET: "Manage own accounts." (provisional)

### Salary Estimate

- Students complete a salary estimate. — not yet linked to a catalog competency

The competency link is the coverage scorer's match, the O*NET items are the closest items in that competency's O*NET bundle by meaning, and provisional items have not been reviewed by faculty.`;

  it('keeps each project and its competency links, without O*NET, unlinked lines or the footnote', () => {
    const s = cleanProjectLinks(LINKS);
    expect(s).toContain('### Internship Fair');
    expect(s).toContain('  - [[agency|Agency]] (K–/U–/D2)');
    expect(s).not.toMatch(/O\*NET|provisional|not yet linked|coverage scorer/);
  });

  it('recognizes links already resolved to wiki pages', () => {
    expect(cleanProjectLinks('### A\n\n- Agency\n  - [Agency](/wiki/competencies/agency) (K–/U–/D2) — closest O*NET: "x" (provisional)')).toBe('### A\n\n- Agency\n  - [Agency](/wiki/competencies/agency) (K–/U–/D2)');
  });

  it('drops a project left with no competency links', () => {
    expect(cleanProjectLinks(LINKS)).not.toContain('Salary Estimate');
  });

  it('returns empty text when nothing is linked', () => {
    expect(cleanProjectLinks('### A\n\n- x — not yet linked to a catalog competency')).toBe('');
  });
});

describe('small helpers', () => {
  it('decodes the HTML entities syllabus text carries', () => {
    expect(decodeEntities('SLO1, &amp; SLO2 &quot;x&quot; &#39;y&#39;')).toBe('SLO1, & SLO2 "x" \'y\'');
  });

  it('summarizes the guide by measure', () => {
    expect(guideSummary(['clear', 'clear', 'partial', 'partial', 'partial', 'partial', 'none'])).toBe('7 objectives: 2 clearly measured, 4 partly measured, 1 without a graded measure yet.');
    expect(guideSummary(['clear'])).toBe('1 objective: 1 clearly measured.');
  });

  it('names the course level from its number, with no 3-Act label', () => {
    expect(courseLevelLabel('GC 4440')).toBe('4000-level course');
    expect(courseLevelLabel('GC 1010')).toBe('1000-level course');
    expect(courseLevelLabel('MKT 3310')).toBe('3000-level course');
  });

  it('states when and from what the course was captured', () => {
    expect(captureFact('2026-06-01', true)).toBe('Captured Jun 1, 2026 from the instructor interview and course materials');
    expect(captureFact('2026-06-01', false)).toBe('Captured Jun 1, 2026 from the instructor interview');
    expect(captureFact(null, false)).toBe('Not yet captured');
  });
});
