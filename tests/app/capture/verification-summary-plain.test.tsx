import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerificationSummary } from '@/app/capture/[code]/VerificationSummary';
import type { CaptureVerificationSummary } from '@/lib/ai/capture/schema';

// Real strings from the GC 3800 draft (2026-10-06), codes and all.
const summary = {
  course_shape: 'Career-readiness seminar; the Budget assignment anchors the deepest D3 evidence.',
  strongest_evidence: [
    'Students calculate personal living costs and salary requirements — D3 via Budget',
    'Communication — D3 via Internship Fair',
  ],
  dimensional_patterns: [
    'LinkedIn profile development — D2/U1: profile construction with limited feedback on rationale',
    'Career path exploration — K2/U2/D1: some reasoning about roles, but output is mostly surveys/quizzes',
  ],
  catalog_vs_evidence: ['Catalog Objective 3 is only lightly evidenced.'],
  foundationals_glance: 'Resilience scored D=0; Communication reached D3.',
  source: 'inferred',
  citations: [],
} as unknown as CaptureVerificationSummary;

describe('VerificationSummary — plain language', () => {
  it('shows no K/U/D score codes anywhere', () => {
    const { container } = render(<VerificationSummary summary={summary} />);
    expect(container.textContent).not.toMatch(/\b[KUD][0-5]\b/);
    expect(container.textContent).not.toMatch(/\b[KUD]=[0-5]\b/);
  });

  it('rewrites "— D3 via Budget" into words with the assignment named', () => {
    render(<VerificationSummary summary={summary} />);
    expect(
      screen.getByText(/calculate personal living costs.*does it independently in familiar situations \(Budget assignment\)/),
    ).toBeInTheDocument();
  });

  it('rewrites combos in every section (patterns, shape, foundationals)', () => {
    render(<VerificationSummary summary={summary} />);
    expect(screen.getByText(/recognizes it and explains it in their own words; does it with step-by-step direction/)).toBeInTheDocument();
    expect(screen.getByText(/Resilience scored Doing \(no evidence students do it yet\)/)).toBeInTheDocument();
    expect(screen.getByText(/anchors the deepest does it independently/)).toBeInTheDocument();
  });

  it('uses dark sentence-case headings, not small gray all-caps labels', () => {
    render(<VerificationSummary summary={summary} />);
    const title = screen.getByRole('heading', { name: 'Does this capture your course?' });
    expect(title.className).not.toMatch(/uppercase/);
    for (const name of ['Course shape', 'What the course is developing', 'Where the system saw mixed signals']) {
      const h = screen.getByRole('heading', { name });
      expect(h.className).not.toMatch(/uppercase/);
      expect(h.className).not.toMatch(/text-muted-foreground/);
      expect(h.className).toMatch(/text-foreground/);
    }
  });

  it('replaces the INFERRED chip with plain copy saying this is the AI\'s reading', () => {
    render(<VerificationSummary summary={summary} />);
    expect(screen.queryByText(/^inferred$/i)).toBeNull();
    expect(screen.getByText(/what the interview found/i)).toBeInTheDocument();
  });

  it('sends reviewers to Looks right / Needs adjusting first, and to the interview only when it is way off (owner, 2026-10-07)', () => {
    const { container } = render(<VerificationSummary summary={summary} />);
    const text = container.textContent ?? '';
    expect(screen.getByRole('note', { name: /how to review/i })).toBeInTheDocument();
    expect(text).toMatch(/Looks right/);
    expect(text).toMatch(/Needs adjusting/);
    // Adjusting comes before going back to the interview.
    expect(text.indexOf('Needs adjusting')).toBeLessThan(text.indexOf('Back to the interview'));
    expect(text).toMatch(/badly wrong/i);
  });

  it('names the real buttons ("Back to the interview", "Approve the profile")', () => {
    const { container } = render(<VerificationSummary summary={summary} />);
    expect(container.textContent).toMatch(/Back to the interview/);
    expect(container.textContent).toMatch(/Approve the profile/);
    expect(container.textContent).not.toMatch(/Confirm and snapshot|Back to chat/);
  });
});
