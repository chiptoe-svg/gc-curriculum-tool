import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaptureChatPanel } from '../CaptureChatPanel';

Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;

const finalTurn = JSON.stringify({
  kind: 'final',
  response: { finding: 'Noted.', question: 'Next?', citations: [], readiness: { score: 40, covered: [], remaining: [], good_enough_to_generate: false } },
  toolCallsUsed: 0,
}) + '\n';

function stubChat() {
  const fetchMock = vi.fn(async () => new Response(finalTurn, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

afterEach(() => vi.unstubAllGlobals());

/** A reload resumes the server session instead of starting a new interviewer
 *  with none of the instructor's answers (owner, 2026-10-28: PKSC 2200 had 7
 *  sessions in one afternoon, readiness falling back to ~20% after each). */
describe('CaptureChatPanel — resume + slim request', () => {
  it('continues the session it was loaded with', async () => {
    const fetchMock = stubChat();
    render(
      <CaptureChatPanel courseCode="PKSC 2200" slug="" messages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]}
        sessionId="sess-1" onSessionIdChange={vi.fn()}
        onMessagesChange={vi.fn()} onGenerate={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
        chooserMode="fresh" onModeChange={vi.fn()} />,
    );
    send('We use a rubric.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.sessionId).toBe('sess-1');
  });

  it('sends only the new message, not the whole conversation', async () => {
    const fetchMock = stubChat();
    render(
      <CaptureChatPanel courseCode="PKSC 2200" slug="" messages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]}
        sessionId={null} onSessionIdChange={vi.fn()}
        onMessagesChange={vi.fn()} onGenerate={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
        chooserMode="fresh" onModeChange={vi.fn()} />,
    );
    send('We use a rubric.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.message).toBe('We use a rubric.');
    expect(body.messages).toBeUndefined();
  });

});

describe('CaptureChatPanel — readiness labels', () => {
  it('says "Covered so far", not "this session" (a resumed interview spans visits)', () => {
    render(
      <CaptureChatPanel courseCode="PKSC 2200" slug="" messages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]}
        initialReadiness={{ score: 49, covered: ['Theme: branding'], remaining: ['Incoming skills'], good_enough_to_generate: false }}
        sessionId="s1" onSessionIdChange={vi.fn()}
        onMessagesChange={vi.fn()} onGenerate={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
        chooserMode="fresh" onModeChange={vi.fn()} />,
    );
    expect(screen.getByText('Covered so far:')).toBeInTheDocument();
    expect(screen.queryByText(/this session/)).toBeNull();
  });
});
