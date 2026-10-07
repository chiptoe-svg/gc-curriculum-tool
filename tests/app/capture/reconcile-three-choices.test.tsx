/**
 * Owner, 2026-10-07: each reconciliation box offers three choices inside it —
 * proceed (green), add or change something, or go back to the interview.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { ReconciliationStepper } from '@/app/capture/[code]/ReconciliationStepper';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const profile = {
  course_code: 'GC 1', scale_version: 'v1', generated_at: 'now',
  competencies: [], incoming_expectations: [], revised_objectives_draft: ['Deliver artwork'],
  verification_summary: { course_shape: 'x', strongest_evidence: [], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, course_emphasis: null,
} as unknown as CaptureProfile;

function setup(onBackToInterview = vi.fn(), onComplete = vi.fn()) {
  render(
    <ReconciliationStepper profile={profile} slug="s" courseCode="GC 1" onComplete={onComplete} onBackToInterview={onBackToInterview} />,
  );
  return { onBackToInterview, onComplete };
}

describe('reconciliation — three choices in the box', () => {
  it('the green proceed button sits inside the section box', () => {
    setup();
    const box = screen.getByRole('region', { name: /apparent outcomes/i });
    const proceed = screen.getByRole('button', { name: /looks good — proceed/i });
    expect(box.contains(proceed)).toBe(true);
    expect(proceed.className).toMatch(/green/);
  });

  it('the feedback box is hidden until "Add or change something" is chosen', () => {
    setup();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /add or change something/i }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('"Back to the interview" calls the handler', () => {
    const { onBackToInterview } = setup();
    fireEvent.click(screen.getByRole('button', { name: /back to the interview/i }));
    expect(onBackToInterview).toHaveBeenCalled();
  });

  it('the last step proceeds to review from inside the box', () => {
    const { onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: /looks good — proceed/i }));
    fireEvent.click(screen.getByRole('button', { name: /looks good — continue to review/i }));
    expect(onComplete).toHaveBeenCalled();
  });

  it('the generating screen gives an honest time estimate', () => {
    const src = readFileSync('app/capture/[code]/CaptureClient.tsx', 'utf8');
    expect(src).not.toMatch(/15–60 seconds/);
    expect(src).toMatch(/usually takes about 2 minutes/i);
  });
});
