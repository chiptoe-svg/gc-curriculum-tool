import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrototypeForm } from '@/components/PrototypeForm';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

const COURSE_LIST = [
  { code: 'GC 4060', title: 'Package & Specialty Printing', level: 4, track: 'Production' },
  { code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Production' },
];

const COURSE_4060 = {
  code: 'GC 4060',
  title: 'Package & Specialty Printing',
  level: 4,
  track: 'Production',
  description: 'Packaging and specialty printing.',
  prerequisites: 'GC 3460',
  syllabusUrl: null,
  learningObjectives: ['Specialty printing processes', 'Flexographic workflow'],
  majorProjects: ['3-Color Spot Functional Label'],
  skillsRequired: ['Color correction'],
};

const COURSE_3460 = {
  code: 'GC 3460',
  title: 'Ink and Substrates',
  level: 3,
  track: 'Production',
  description: 'Ink and substrate science.',
  prerequisites: '',
  syllabusUrl: null,
  learningObjectives: ['Ink manufacturing'],
  majorProjects: ['Brand Color Report'],
  skillsRequired: ['Color theory'],
};

beforeEach(() => {
  // Route fetches by URL so the targets dropdown, the courses list, and per-code
  // detail fetches all resolve to the right fixtures.
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/targets')) {
      return Promise.resolve({
        ok: true,
        json: async () => CAREER_TARGETS.map((t) => ({ id: t.id, name: t.name })),
      } as Response);
    }
    if (url.startsWith('/api/courses?')) {
      return Promise.resolve({ ok: true, json: async () => COURSE_LIST } as Response);
    }
    if (url.includes('/api/courses/')) {
      const body = url.includes('4060') ? COURSE_4060 : COURSE_3460;
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
  }) as unknown as typeof fetch;
});

describe('PrototypeForm', () => {
  it('renders course selector, prior coursework selector, and Analyze button', async () => {
    render(<PrototypeForm slug="test-slug" onAnalyze={vi.fn()} isAnalyzing={false} />);
    expect(screen.getByLabelText(/course being analyzed \(by code\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^prior course 1$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('disables Analyze when no courses are picked', () => {
    render(<PrototypeForm slug="test-slug" onAnalyze={vi.fn()} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /analyze/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAnalyze with labeled markdown syllabi when submitted', async () => {
    const onAnalyze = vi.fn();
    render(<PrototypeForm slug="test-slug" onAnalyze={onAnalyze} isAnalyzing={false} />);
    // Wait for the courses to load into both selectors.
    await waitFor(() => {
      const matches = screen.getAllByRole('button', { name: /package & specialty printing/i });
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
    // Pick the Course being analyzed (GC 4060). The course-selector list is first.
    const courseButtons = screen.getAllByRole('button', { name: /package & specialty printing/i });
    fireEvent.click(courseButtons[0]!);
    // Wait until the editable details for GC 4060 render — implies the detail fetch resolved.
    await waitFor(() => expect(screen.getByDisplayValue(/Packaging and specialty printing\./i)).toBeInTheDocument());

    // Pick prior course (GC 3460). After exclusion, only Ink and Substrates remains in the prior list.
    const priorButtons = screen.getAllByRole('button', { name: /ink and substrates/i });
    fireEvent.click(priorButtons[priorButtons.length - 1]!);
    await waitFor(() => expect(screen.getByDisplayValue(/Ink and substrate science\./i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));

    expect(onAnalyze).toHaveBeenCalledTimes(1);
    const arg = onAnalyze.mock.calls[0]![0];
    expect(arg.course.courseLabel).toBe('GC 4060');
    expect(arg.course.syllabusText).toContain('# GC 4060 — Package & Specialty Printing');
    expect(arg.course.syllabusText).toContain('## Learning Objectives');
    expect(arg.priorCoursework).toHaveLength(1);
    expect(arg.priorCoursework[0]!.courseLabel).toBe('GC 3460');
    expect(arg.priorCoursework[0]!.syllabusText).toContain('# GC 3460 — Ink and Substrates');
  });

  it('Add prior course button adds a second prior course row', async () => {
    render(<PrototypeForm slug="test-slug" onAnalyze={vi.fn()} isAnalyzing={false} />);
    expect(screen.queryByLabelText(/^prior course 2$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add prior course/i }));
    expect(screen.getByLabelText(/^prior course 2$/i)).toBeInTheDocument();
  });
});
