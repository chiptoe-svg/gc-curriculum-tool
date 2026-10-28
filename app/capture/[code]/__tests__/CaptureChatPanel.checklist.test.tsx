import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CaptureChatPanel } from '../CaptureChatPanel';

Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;

const readiness = { score: 55, covered: ['Theme: palletization'], remaining: ['Incoming skills'], good_enough_to_generate: false };
const finalTurn = JSON.stringify({ kind: 'final', response: { finding: 'Noted.', question: 'Next?', citations: [], readiness }, toolCallsUsed: 0 }) + '\n';

function panel(extra: Record<string, unknown> = {}) {
  return render(
    <CaptureChatPanel courseCode="PKSC 2200" slug="" messages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]}
      initialReadiness={{ score: 49, covered: ['Theme: branding'], remaining: ['Incoming skills', 'Theme: palletization'], good_enough_to_generate: false }}
      initialChecklist={{ covered: ['Theme: branding', 'DayQuil independent execution'], remaining: ['Incoming skills', 'Theme: palletization'] }}
      sessionId="s1" onSessionIdChange={vi.fn()}
      onMessagesChange={vi.fn()} onGenerate={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
      chooserMode="fresh" onModeChange={vi.fn()} {...extra} />,
  );
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

afterEach(() => vi.unstubAllGlobals());

/** The checklist beside the chat (owner, 2026-10-28): the interviewer's
 *  changing to-do list, an "Updating…" state while it thinks, and every
 *  checked-off item kept (including those from before a reload). */
describe('CaptureChatPanel — interview checklist', () => {
  it('shows what is still to cover and everything covered so far, from the page load', () => {
    panel();
    const list = screen.getByTestId('interview-checklist');
    expect(within(list).getByText('Still to cover')).toBeInTheDocument();
    expect(within(list).getByText('Incoming skills')).toBeInTheDocument();
    expect(within(list).getByText('DayQuil independent execution')).toBeInTheDocument();
  });

  it('says it is updating while the interviewer works', async () => {
    let release!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { release = () => r(new Response(finalTurn, { status: 200 })); })));
    panel();
    send('We palletize in week 12.');
    await waitFor(() => expect(within(screen.getByTestId('interview-checklist')).getByText('Updating…')).toBeInTheDocument());
    release();
    await waitFor(() => expect(within(screen.getByTestId('interview-checklist')).queryByText('Updating…')).toBeNull());
  });

  it('checks off a newly covered item, marks it new, and keeps the earlier ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(finalTurn, { status: 200 })));
    panel();
    send('We palletize in week 12.');
    const list = await screen.findByTestId('interview-checklist');
    await waitFor(() => expect(within(list).getByTestId('covered-Theme: palletization')).toBeInTheDocument());
    expect(within(list).getByTestId('covered-Theme: palletization').getAttribute('data-new')).toBe('true');
    expect(within(list).getByText('DayQuil independent execution')).toBeInTheDocument();
    expect(within(list).getByText('Theme: branding')).toBeInTheDocument();
  });
});

describe('InterviewChecklist — long covered list', () => {
  it('shows the newest 10 checked items and a link to show all', async () => {
    const { InterviewChecklist } = await import('../InterviewChecklist');
    const covered = Array.from({ length: 54 }, (_, i) => `Item ${i + 1}`);
    render(<InterviewChecklist checklist={{ covered, remaining: ['Incoming skills'] }} justCovered={[]} updating={false} />);
    expect(screen.getByText('Item 10')).toBeInTheDocument();
    expect(screen.queryByText('Item 11')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 54' }));
    expect(screen.getByText('Item 54')).toBeInTheDocument();
  });
});
