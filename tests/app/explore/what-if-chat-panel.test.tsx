import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/VoiceRecorder', () => ({ VoiceRecorder: () => <button type="button">Record</button> }));

import { WhatIfChatPanel } from '@/app/explore/[code]/what-ifs/[id]/talk/WhatIfChatPanel';

const ID = '11111111-1111-4111-8111-111111111111';
const BASE = `/api/explore/GC%203460/what-ifs/${ID}`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ndjson = (events: unknown[]) =>
  new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
const FINAL = { kind: 'final', toolCallsUsed: 0, response: { response: 'Which assignment would that replace?', citations: [] } };

type Handlers = Partial<Record<'messages' | 'chat' | 'attachments' | 'page', (init?: RequestInit) => Response | Promise<Response>>>;
function mockFetch(h: Handlers = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(`${BASE}/messages`)) return (h.messages ?? (() => json({ messages: [] })))(init);
    if (u.startsWith(`${BASE}/chat`)) return (h.chat ?? (() => ndjson([FINAL])))(init);
    if (u.startsWith(`${BASE}/attachments`)) return (h.attachments ?? (() => json({ attachment: { id: 'a1', fileName: 'x.pdf', status: 'ok', heldBackReason: null } }, 201)))(init);
    if (u.startsWith(`${BASE}/page`)) return (h.page ?? (() => json({ ok: true })))(init);
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const callsTo = (fn: ReturnType<typeof mockFetch>, suffix: string) => fn.mock.calls.filter(c => String(c[0]).startsWith(`${BASE}/${suffix}`));

const renderPanel = (props: Partial<React.ComponentProps<typeof WhatIfChatPanel>> = {}) =>
  render(<WhatIfChatPanel courseCode="GC 3460" whatIfId={ID} slug="s" hasPage={false} {...props} />);
const reply = () => screen.getByLabelText(WHAT_IF_COPY.replyLabel) as HTMLTextAreaElement;
async function send(text: string) {
  fireEvent.change(reply(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.send }));
}
const file = (name = 'outline.pdf', type = 'application/pdf') => new File(['x'], name, { type });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

describe('WhatIfChatPanel', () => {
  it('shows the fixed opening line when there are no messages', async () => {
    mockFetch();
    renderPanel();
    expect(await screen.findByText(WHAT_IF_COPY.opening)).toBeInTheDocument();
  });

  it('loads earlier messages from the messages route instead of the opening line', async () => {
    const fn = mockFetch({ messages: () => json({ messages: [
      { id: 'm1', role: 'user', content: 'Add a weekly preflight lab', meta: null },
      { id: 'm2', role: 'assistant', content: 'What would it replace?', meta: { citations: [], quickEstimates: [] } },
    ] }) });
    renderPanel();
    expect(await screen.findByText('Add a weekly preflight lab')).toBeInTheDocument();
    expect(screen.getByText('What would it replace?')).toBeInTheDocument();
    expect(screen.queryByText(WHAT_IF_COPY.opening)).toBeNull();
    expect(callsTo(fn, 'messages')).toHaveLength(1);
  });

  it('posts the message to the chat route, shows the reply and clears the box', async () => {
    const fn = mockFetch();
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('Add a weekly preflight lab');
    expect(await screen.findByText('Which assignment would that replace?')).toBeInTheDocument();
    const [, init] = callsTo(fn, 'chat')[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ message: 'Add a weekly preflight lab' });
    expect(screen.getByText('Add a weekly preflight lab')).toBeInTheDocument();
    await waitFor(() => expect(reply().value).toBe(''));
  });

  it('a failed turn keeps the typed text in the box, shows the error and leaves no unsent message in the transcript', async () => {
    mockFetch({ chat: () => ndjson([{ kind: 'error', message: 'The model is unavailable.' }]) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('Add a weekly preflight lab');
    expect(await screen.findByText('The model is unavailable.')).toBeInTheDocument();
    expect(reply().value).toBe('Add a weekly preflight lab');
    // The transcript does not show an unsent message; the only element holding the text is the box.
    const holders = screen.getAllByText('Add a weekly preflight lab');
    expect(holders).toHaveLength(1);
    expect(holders[0]!.tagName).toBe('TEXTAREA');
    // And the panel is usable again.
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.send })).toBeEnabled();
  });

  it('shows the friendly message when the AI credits are used up', async () => {
    mockFetch({ chat: () => ndjson([{ kind: 'error', code: 'ai_credits_exhausted', message: 'The shared AI credits are used up.' }]) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('hello');
    expect(await screen.findByText('The shared AI credits are used up.')).toBeInTheDocument();
    expect(reply().value).toBe('hello');
  });

  it('a non-stream error response (daily cap) shows its message and keeps the text', async () => {
    mockFetch({ chat: () => json({ error: 'daily cost cap reached — service paused for today' }, 503) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('hello');
    expect(await screen.findByText('daily cost cap reached — service paused for today')).toBeInTheDocument();
    expect(reply().value).toBe('hello');
  });

  it('renders an estimate event\'s ratings from the event data, marked predicted', async () => {
    const estimateEvent = { kind: 'estimate', estimate: {
      candidate: 'Weekly lab',
      estimate: { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] },
      profile: { incomingChanges: [], ratings: [
        { statement: 'Prepare print-ready files', type: 'technical', status: 'moved', kud: { k: 3, u: 3, d: 2 }, before: { k: 3, u: 3, d: 3 }, confidence: 'medium', reason: 'Less handoff time', subCompetencyId: null, linked: true },
        { statement: 'Untouched rating', type: 'technical', status: 'approved', kud: { k: 1, u: 1, d: 1 }, before: { k: 1, u: 1, d: 1 }, confidence: null, reason: null, subCompetencyId: null, linked: true },
      ] },
      knockOn: { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [] },
    } };
    mockFetch({ chat: () => ndjson([estimateEvent, FINAL]) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('What if we add a lab?');
    expect(await screen.findByText('Prepare print-ready files')).toBeInTheDocument();
    expect(screen.getByText(/D3\s*→\s*D2/)).toBeInTheDocument();
    expect(screen.getByText('predicted')).toBeInTheDocument();
    expect(screen.queryByText('Untouched rating')).toBeNull();
  });

  it('a stored assistant message with quick estimates shows them after a reload', async () => {
    mockFetch({ messages: () => json({ messages: [
      { id: 'm1', role: 'user', content: 'What if?', meta: null },
      { id: 'm2', role: 'assistant', content: 'Here is the estimate.', meta: { citations: [], quickEstimates: [{
        candidate: 'Weekly lab',
        estimate: { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] },
        profile: { incomingChanges: [], ratings: [
          { statement: 'Soft proofing', type: 'technical', status: 'new', kud: { k: 1, u: 1, d: 1 }, before: null, confidence: 'low', reason: 'New lab', subCompetencyId: null, linked: false },
        ] },
        knockOn: { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [] },
      }] } },
    ] }) });
    renderPanel();
    expect(await screen.findByText('Soft proofing')).toBeInTheDocument();
  });

  it('the file picker, a drop and a pasted image each post to the attachments route', async () => {
    const fn = mockFetch();
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);

    fireEvent.change(screen.getByLabelText(WHAT_IF_COPY.attach), { target: { files: [file('picked.pdf')] } });
    await waitFor(() => expect(callsTo(fn, 'attachments')).toHaveLength(1));

    fireEvent.drop(screen.getByTestId('what-if-panel'), { dataTransfer: { files: [file('dropped.pdf')] } });
    await waitFor(() => expect(callsTo(fn, 'attachments')).toHaveLength(2));

    fireEvent.paste(reply(), { clipboardData: { files: [file('image.png', 'image/png')] } });
    await waitFor(() => expect(callsTo(fn, 'attachments')).toHaveLength(3));

    const names = callsTo(fn, 'attachments').map(c => ((c[1] as RequestInit).body as FormData).get('file') as File).map(f => f.name);
    expect(names).toEqual(['picked.pdf', 'dropped.pdf', 'image.png']);
    expect((callsTo(fn, 'attachments')[0]![1] as RequestInit).method).toBe('POST');
  });

  it('a held-back or failed attachment shows its reason', async () => {
    let n = 0;
    mockFetch({ attachments: () => json({ attachment: n++ === 0
      ? { id: 'a1', fileName: 'roster.xlsx', status: 'held_back', heldBackReason: 'Looks like a student roster.' }
      : { id: 'a2', fileName: 'broken.pdf', status: 'failed', heldBackReason: null } }, 201) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    fireEvent.change(screen.getByLabelText(WHAT_IF_COPY.attach), { target: { files: [file('roster.xlsx'), file('broken.pdf')] } });
    expect(await screen.findByText(/Looks like a student roster\./)).toBeInTheDocument();
    expect(await screen.findByText(WHAT_IF_COPY.attachmentFailed)).toBeInTheDocument();
  });

  it('shows the route\'s message when an upload is refused', async () => {
    mockFetch({ attachments: () => json({ error: 'Unsupported MIME type: text/plain.' }, 400) });
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    fireEvent.change(screen.getByLabelText(WHAT_IF_COPY.attach), { target: { files: [file('a.txt', 'text/plain')] } });
    expect(await screen.findByText(/Unsupported MIME type/)).toBeInTheDocument();
  });

  it('Create the what-if page is disabled until there is a first message, then posts to the page route and opens the page', async () => {
    const fn = mockFetch();
    renderPanel();
    await screen.findByText(WHAT_IF_COPY.opening);
    const create = () => screen.getByRole('button', { name: WHAT_IF_COPY.createPage });
    expect(create()).toBeDisabled();
    await send('Add a weekly preflight lab');
    await screen.findByText('Which assignment would that replace?');
    expect(create()).toBeEnabled();
    fireEvent.click(create());
    await waitFor(() => expect(callsTo(fn, 'page')).toHaveLength(1));
    expect((callsTo(fn, 'page')[0]![1] as RequestInit).method).toBe('POST');
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/explore/GC%203460/what-ifs/${ID}?slug=s`));
  });

  it('is enabled from the start when earlier messages exist, and offers Update when a page exists', async () => {
    mockFetch({ messages: () => json({ messages: [{ id: 'm1', role: 'user', content: 'Earlier', meta: null }] }) });
    renderPanel({ hasPage: true });
    await screen.findByText('Earlier');
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.updatePage })).toBeEnabled();
  });

  it('shows the message when creating the page is refused', async () => {
    mockFetch({ page: () => json({ error: 'The approved version this revision started from was withdrawn.', code: 'baseline_withdrawn' }, 409) });
    renderPanel({ hasPage: true });
    await screen.findByText(WHAT_IF_COPY.opening);
    await send('hello');
    await screen.findByText('Which assignment would that replace?');
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.updatePage }));
    expect(await screen.findByText(/was withdrawn/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
