import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CaptureChatPanel, type ChatMessage } from '../CaptureChatPanel';

// jsdom has no Element.scrollTo; the panel auto-scrolls the transcript on change.
Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;

function renderPanel(messages: ChatMessage[]) {
  return render(
    <CaptureChatPanel
      courseCode="GC 4060"
      slug=""
      messages={messages}
      onMessagesChange={vi.fn()}
      onGenerate={vi.fn()}
      chooserInstructor="Test Instructor"
      onInstructorChange={vi.fn()}
      chooserMode="fresh"
      onModeChange={vi.fn()}
    />,
  );
}

const Q1 = 'How do you grade the press setup?';
const Q2 = 'For the Functional Label project, what can each student perform alone?';

describe('CaptureChatPanel — interviewer question block', () => {
  it('renders the latest question in its own labeled block, once, after the finding', () => {
    renderPanel([
      { role: 'assistant', content: `First finding.\n\n${Q1}` },
      { role: 'user', content: 'We use a rubric.' },
      { role: 'assistant', content: `The digests show a gap.\n\n${Q2}` },
    ]);
    const blocks = screen.getAllByTestId('interviewer-question');
    // Only the current (latest) turn gets the marked block.
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(within(block).getByText('Question for you')).toBeInTheDocument();
    expect(within(block).getByText(Q2)).toBeInTheDocument();
    // Never shown twice.
    expect(screen.getAllByText(Q2, { exact: false })).toHaveLength(1);
    // The finding is rendered separately, before the question.
    const finding = screen.getByText('The digests show a gap.');
    expect(finding.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses the separate question field on new turns and does not duplicate it', () => {
    renderPanel([
      { role: 'assistant', content: `A finding.\n\n${Q2}`, question: Q2 },
    ]);
    expect(within(screen.getByTestId('interviewer-question')).getByText(Q2)).toBeInTheDocument();
    expect(screen.getAllByText(Q2, { exact: false })).toHaveLength(1);
  });

  it('places citation chips with the finding, before the question block', () => {
    renderPanel([
      {
        role: 'assistant',
        content: `A finding.\n\n${Q2}`,
        question: Q2,
        citations: [{ type: 'chunk', chunkId: 'c1', excerpt: 'Station Set up rubric row' }],
      },
    ]);
    const chip = screen.getByText('Station Set up rubric row');
    const block = screen.getByTestId('interviewer-question');
    expect(chip.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('older turns keep their question compact (no second marked block)', () => {
    renderPanel([
      { role: 'assistant', content: `First finding.\n\n${Q1}` },
      { role: 'user', content: 'Reply.' },
      { role: 'assistant', content: 'Thanks, noted.' },
    ]);
    expect(screen.queryAllByTestId('interviewer-question')).toHaveLength(0);
    expect(screen.getAllByText(Q1, { exact: false })).toHaveLength(1);
  });
});
