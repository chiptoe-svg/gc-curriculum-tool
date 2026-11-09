import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CoursePageLayout } from '../CoursePageLayout';
import type { CourseViews } from '@/lib/wiki/course-views';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';

const BODY = `This project-heavy course brings current challenges into the classroom.

## At a glance

- — **Course shape:** Project-heavy integration.

## Who it's for

Seniors in the packaging track.

## The arc

Students move from framing to testing.

## Competencies developed

### Technical competencies

- Conceptual development — K3/U3/D4 ·materials — excerpt

## Audit notes

- Catalog objectives 4–6 are only partly evidenced.

## Class structure

Weekly studio plus critique.

## Signature projects

### Cultural packaging

A package concept for another culture.

## How the projects connect

### Cultural packaging

- Design
  - [Conceptual development](/wiki/competencies/conceptual-development) (K3/U3/D4) — closest O*NET: "Design packages." (provisional)
- Students research a market. — not yet linked to a catalog competency

The competency link is the coverage scorer's match, the O*NET items are the closest items in that competency's O*NET bundle by meaning, and provisional items have not been reviewed by faculty.

## Syllabus

Investigates current challenges.

**Learning objectives:**

- Critically analyzed trends (SLO1, &amp; SLO2).

**Signature projects:** see [Signature projects](#signature-projects) above.

**Links:** [Syllabus PDF](https://example.edu/s)

## Source snapshots

- [2026-06-01](raw/snapshots/x.json)

## Cross-references

See [three-act structure](/wiki/concepts/three-act-structure).
`;

const VIEWS: CourseViews = {
  objectives: ['Critically analyze current trends.', 'Communicate findings to industry.'],
  arrivalSkills: ['Prepress fundamentals'],
  evidence: {
    capturedOn: '2026-06-01',
    rows: [
      { statement: 'Conceptual development', foundational: false, k: 3, u: 3, d: 4, evidence: 'materials' },
      { statement: 'Agency', foundational: true, k: null, u: null, d: 3, evidence: 'claimed' },
    ],
    disagreements: ['Objectives 4–6 are only partly evidenced.'],
  },
  predicted: [],
} as unknown as CourseViews;

const GUIDE: ObjectiveGuideSection = {
  kind: 'guide', capturedOn: '2026-06-01', text: 't', canvasPrompt: 'p',
  guide: {
    intro: 'Pull class-level numbers.',
    objectives: [
      { objective: 'Analyze trends (SLO1, &amp; SLO2).', measure: 'clear', evidence: [], gather: 'g', suggestion: null },
      { objective: 'Present findings.', measure: 'partial', evidence: [], gather: 'g', suggestion: null },
    ],
    checklist: [],
  },
};

function setup(over: Partial<React.ComponentProps<typeof CoursePageLayout>> = {}) {
  return render(
    <CoursePageLayout body={BODY} views={VIEWS} guide={GUIDE} q=""
      buildsToward={[{ href: '/wiki/targets/packaging', label: 'Packaging' }]}
      develops={[{ href: '/wiki/competencies/agency', label: 'Agency' }]} {...over} />,
  );
}
const h2s = () => screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);

describe('CoursePageLayout', () => {
  it('orders the sections the way a reader asks', () => {
    setup();
    expect(h2s()).toEqual([
      'About this course',
      'Stated objectives vs. what we found',
      'What students learn',
      'Projects',
      'Where it fits in the program',
      'For the instructor',
      'Sources and limits',
    ]);
  });

  it('has an "On this page" list linking every section', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const hrefs = within(nav).getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['#about', '#objectives', '#learn', '#projects', '#program', '#instructor', '#sources']);
  });

  it('opens with the course narrative and folds in who it is for, the arc, structure and arrival skills', () => {
    setup();
    const about = document.getElementById('about')!;
    expect(about.textContent).toContain('This project-heavy course brings current challenges');
    expect(about.textContent).toContain('Seniors in the packaging track.');
    expect(about.textContent).toContain('Students move from framing to testing.');
    expect(about.textContent).toContain('Weekly studio plus critique.');
    expect(about.textContent).toContain('Prepress fundamentals');
    expect(about.textContent).not.toContain('- —');
  });

  it('shows each fact once: objectives, competency scores', () => {
    setup();
    expect(screen.getAllByText('Critically analyze current trends.')).toHaveLength(1);
    expect(screen.queryByText(/Critically analyzed trends/)).toBeNull();
    expect(screen.getAllByText('Conceptual development', { selector: 'td' })).toHaveLength(1);
    expect(screen.queryByText(/·materials/)).toBeNull();
  });

  it('keeps project competency links but no O*NET trail or pipeline notes', () => {
    setup();
    const projects = document.getElementById('projects')!;
    expect(projects.textContent).toContain('A package concept for another culture.');
    expect(within(projects).getByRole('link', { name: 'Conceptual development' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/O\*NET|provisional|not yet linked|coverage scorer/);
  });

  it('puts the assessment guide in a collapsed block with a one-line summary', () => {
    setup();
    const details = document.getElementById('instructor')!.querySelector('details')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('2 objectives: 1 clearly measured, 1 partly measured.');
    expect(details.textContent).toContain('Analyze trends (SLO1, & SLO2).');
  });

  it('ends with sources and the limits of the capture, without raw snapshot links', () => {
    setup();
    const sources = document.getElementById('sources')!;
    expect(within(sources).getByRole('heading', { name: 'Limits of this capture' })).toBeTruthy();
    expect(sources.textContent).toContain('Catalog objectives 4–6 are only partly evidenced.');
    expect(within(sources).getByRole('link', { name: 'Syllabus PDF' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Source snapshots');
    expect(document.querySelector('a[href*="raw/snapshots"]')).toBeNull();
  });

  it('hides the prediction table when none has been run, with no "not run yet" message', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/has not been run|No syllabus-based prediction/);
  });

  it('falls back to the generated competency list when the course has no captured evidence', () => {
    setup({ views: { ...VIEWS, evidence: null } as CourseViews });
    expect(document.getElementById('learn')!.textContent).toContain('Conceptual development');
  });
});
