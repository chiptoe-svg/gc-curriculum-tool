import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObjectiveGuidePanel, NO_SYLLABUS_NOTICE, SET_ASIDE_NOTICE } from '../ObjectiveGuidePanel';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';

const SECTION: ObjectiveGuideSection = {
  kind: 'guide',
  capturedOn: '2026-10-05',
  text: 'PLAIN TEXT VERSION',
  canvasPrompt: 'CANVAS AI PROMPT VERSION',
  guide: {
    intro: 'Pull a few class-level numbers at the end of term.',
    objectives: [
      { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
        evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The Research depth distribution.', suggestion: null },
      { objective: 'Present a strategic rationale to a client.', measure: 'partial',
        evidence: [{ assignment: 'Final Brand Playbook', rubric_row: null }], gather: 'The playbook score distribution.', suggestion: 'Add a Rationale row.' },
    ],
    checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }, { assignment: 'Final Brand Playbook', rubric_row: null }],
  },
};

describe('ObjectiveGuidePanel', () => {
  it('renders the section title, each objective with its label, the checklist and the footnote', () => {
    render(<ObjectiveGuidePanel section={SECTION} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Assessing the course objectives' })).toBeTruthy();
    expect(screen.getByText('Develop a brand strategy grounded in audience research.')).toBeTruthy();
    expect(screen.getByText('Clearly measured')).toBeTruthy();
    expect(screen.getByText('Partly measured')).toBeTruthy();
    expect(screen.getByText('Add a Rationale row.')).toBeTruthy();
    const checklist = screen.getByRole('list', { name: /items to pull from canvas/i });
    expect(checklist.textContent).toContain('Brand Audit, rubric row "Research depth"');
    expect(checklist.textContent).toContain('Final Brand Playbook');
    expect(screen.getByText(/Built from the capture of Oct 5, 2026\./)).toBeTruthy();
  });

  it('Copy as text puts the plain-text rendering on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ObjectiveGuidePanel section={SECTION} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('PLAIN TEXT VERSION'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('shows the Canvas AI prompt disclosure with its explanation and the prompt text, and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ObjectiveGuidePanel section={SECTION} />);
    expect(screen.getByText('Copy as a Canvas AI prompt')).toBeTruthy();
    expect(screen.getByText(/Paste into an AI assistant connected to your Canvas course/)).toBeTruthy();
    expect(screen.getByText('CANVAS AI PROMPT VERSION')).toBeTruthy();
    expect(screen.queryByText('Show as plain text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('CANVAS AI PROMPT VERSION'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('shows the no-syllabus and set-aside notices', () => {
    const { unmount } = render(<ObjectiveGuidePanel section={{ kind: 'no-syllabus' }} />);
    expect(screen.getByText(NO_SYLLABUS_NOTICE)).toBeTruthy();
    unmount();
    render(<ObjectiveGuidePanel section={{ kind: 'syllabus-set-aside' }} />);
    expect(screen.getByText(SET_ASIDE_NOTICE)).toBeTruthy();
    expect(SET_ASIDE_NOTICE).toContain('the syllabus is set aside');
    expect(SET_ASIDE_NOTICE).toContain('include it on the capture page');
  });
});
