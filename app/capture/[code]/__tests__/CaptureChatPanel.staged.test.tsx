import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaptureChatPanel, type ChatMessage } from '../CaptureChatPanel';
import type { AuditStagedBlock } from '@/lib/ai/agent/audit-response-schema';

Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;
afterEach(() => vi.unstubAllGlobals());

const TITLES = ['The course in your words', 'Evidence walk', 'When it goes wrong, and the leap', 'What students walk in with', 'Habits and communication', 'Objectives and close'];
const block = (stage: 1 | 2 | 3 | 4 | 5 | 6, over: Partial<AuditStagedBlock> = {}): AuditStagedBlock => ({
  stage,
  stageTitle: TITLES[stage - 1]!,
  stageProgress: TITLES.map((title, i) => ({ id: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6, title, status: i + 1 < stage ? 'done' : i + 1 === stage ? 'active' : 'upcoming' })),
  questionsAsked: 5,
  cap: 20,
  slotAsked: 'conditions',
  kind: 'question',
  ...over,
});

const MSGS: ChatMessage[] = [
  { role: 'assistant', content: 'Finding.\n\nWhat do students make?', question: 'What do students make?' },
];

function renderPanel(over: Partial<React.ComponentProps<typeof CaptureChatPanel>> = {}) {
  const onGenerate = vi.fn();
  const utils = render(
    <CaptureChatPanel
      courseCode="GC 4060" slug="s" messages={MSGS} onMessagesChange={vi.fn()} onGenerate={onGenerate}
      sessionId="sess-1" onSessionIdChange={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
      chooserMode="fresh" onModeChange={vi.fn()} staged initialStaged={block(2)} {...over}
    />,
  );
  return { ...utils, onGenerate };
}

/** A chat stream whose last event is a final staged reply. */
function chatStream(staged: AuditStagedBlock) {
  const final = { finding: 'Next.', question: 'And then?', citations: [], readiness: { score: 30, covered: [], remaining: [], good_enough_to_generate: false }, staged };
  return new Response(JSON.stringify({ kind: 'final', response: final }) + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}
const chatBody = (f: ReturnType<typeof vi.fn>) => {
  const call = f.mock.calls.find(c => String(c[0]).includes('/chat?'))!;
  return JSON.parse((call[1] as RequestInit).body as string);
};

describe('CaptureChatPanel — staged interview', () => {
  it('shows the stage bar and Skip, and hides the interview checklist', () => {
    renderPanel();
    expect(screen.getByText('Stage 2 of 6 — Evidence walk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip this question' })).toBeInTheDocument();
    expect(screen.queryByTestId('interview-checklist')).toBeNull();
  });

  it('a classic session renders no stage bar, no Skip, and keeps the checklist', () => {
    renderPanel({ staged: false, initialStaged: null });
    expect(screen.queryByText(/Stage \d of 6/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip this question' })).toBeNull();
    expect(screen.getByTestId('interview-checklist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /one last question/ })).toBeInTheDocument();
  });

  it('Skip posts exactly "Skip this question"', async () => {
    const f = vi.fn(async () => chatStream(block(2, { questionsAsked: 6 })));
    vi.stubGlobal('fetch', f);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this question' }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(chatBody(f).message).toBe('Skip this question');
  });

  it('Finish posts finish:true with no message, and not the classic last-question text', async () => {
    const f = vi.fn(async () => chatStream(block(6, { kind: 'recap', slotAsked: 'recap' })));
    vi.stubGlobal('fetch', f);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Finish the interview' }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    const body = chatBody(f);
    expect(body.finish).toBe(true);
    expect(body.message).toBeUndefined();
    expect(body.sessionId).toBe('sess-1');
  });

  it('a normal reply does not send finish', async () => {
    const f = vi.fn(async () => chatStream(block(2)));
    vi.stubGlobal('fetch', f);
    renderPanel();
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'They make a label.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(chatBody(f).finish).toBeUndefined();
    expect(chatBody(f).message).toBe('They make a label.');
  });

  it('after the recap turn the finish button becomes Generate Profile', () => {
    const { onGenerate } = renderPanel({ initialStaged: block(6, { kind: 'recap', slotAsked: 'recap' }) });
    expect(screen.queryByRole('button', { name: 'Finish the interview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Profile' }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('moves the stage bar when a reply carries a new stage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatStream(block(3, { slotAsked: 'revision' }))));
    renderPanel();
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Stage 3 of 6 — When it goes wrong, and the leap')).toBeInTheDocument();
  });

  it('stage 4 shows the incoming-skills card from the evidence map, and submits its message', async () => {
    const map = { summary: '', graded_work: [], tests: [], competencies: [], objectives: [], conflicts: [], unreadable: [],
      assumed_skills: [{ skill: 'Color theory', used_in: 'x', source: 's' }, { skill: 'Imposition', used_in: 'y', source: 's' }, { skill: 'Color theory', used_in: 'z', source: 's' }] };
    const f = vi.fn(async (url: string) => String(url).includes('/evidence-map')
      ? new Response(JSON.stringify({ sessionId: 'sess-1', map, status: 'ready' }), { status: 200, headers: { 'content-type': 'application/json' } })
      : chatStream(block(4, { slotAsked: 'reteach' })));
    vi.stubGlobal('fetch', f);
    renderPanel({ initialStaged: block(4, { slotAsked: 'incoming' }) });
    await screen.findByRole('radio', { name: 'Imposition: needs a refresher' });
    expect(screen.getAllByRole('radio', { name: /^Color theory:/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Color theory: arrives able' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Imposition: needs a refresher' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send these answers' }));
    await waitFor(() => expect(f.mock.calls.some(c => String(c[0]).includes('/chat?'))).toBe(true));
    expect(chatBody(f).message).toBe('Color theory: arrives able\nImposition: needs a refresher');
    expect(String(f.mock.calls[0]![0])).toContain('/evidence-map?slug=s&sessionId=sess-1');
  });

  it('no card on other stages, and none when the map lists no skills', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    renderPanel({ initialStaged: block(2) });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('never shows the word slot', () => {
    const { container } = renderPanel({ initialStaged: block(4, { slotAsked: 'incoming' }) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(container.textContent?.toLowerCase()).not.toMatch(/\bslot\b/);
  });
});
