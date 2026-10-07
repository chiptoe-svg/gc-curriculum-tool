import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom doesn't implement scrollTo on Element — stub it so the panel's
// useEffect doesn't throw.
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

// Mock sub-components that require browser APIs or server imports.
vi.mock('@/components/VoiceRecorder', () => ({
  VoiceRecorder: () => null,
}));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({
  CitationDrawer: () => null,
}));
vi.mock('@/lib/faculty', () => ({
  FACULTY_ROSTER: ['Instructor A', 'Instructor B'],
}));

import { CaptureChatPanel } from '@/app/capture/[code]/CaptureChatPanel';

// Build a minimal streaming Response that emits one NDJSON event then closes.
function streamRes(event: object): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

// The panel reads events with `kind` field. A minimal `final` event that
// satisfies postChat's response handling.
const FINAL_EVENT = {
  kind: 'final',
  response: {
    finding: 'One question: do students revise after a failed run?',
    question: '',
    citations: [],
    readiness: {
      score: 60,
      covered: ['design process'],
      remaining: ['productive failure'],
      good_enough_to_generate: false,
    },
  },
};

describe('CaptureChatPanel — one last question', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamRes(FINAL_EVENT)));
  });

  function setup(messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'assistant', content: 'Opening question?' }], onGenerate = () => {}) {
    render(
      <CaptureChatPanel
        courseCode="GC 2400"
        slug="s"
        messages={messages}
        onMessagesChange={() => {}}
        onGenerate={onGenerate}
        chooserInstructor="Instructor A"
        onInstructorChange={() => {}}
        chooserMode="fresh"
        onModeChange={() => {}}
      />,
    );
  }

  it('does not render the old "didn\'t cover problem-solving" warning', () => {
    setup();
    expect(screen.queryByText(/didn.t cover problem-solving/i)).toBeNull();
  });

  it('before the last question there is ONE finish button, and it asks for the last question', async () => {
    setup();
    expect(screen.queryByRole('button', { name: /generate profile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /one more important question/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /i.m done — give me one last question/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = String(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body,
    );
    expect(body).toMatch(/single most important question still missing/i);
  });

  it('after the last question is asked, the button becomes Generate Profile with an answer-first hint', () => {
    const onGenerate = vi.fn();
    const CANNED = "I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words.";
    setup([
      { role: 'assistant', content: 'Opening question?' },
      { role: 'user', content: CANNED },
      { role: 'assistant', content: 'Last: how do students revise?' },
    ], onGenerate);
    expect(screen.queryByRole('button', { name: /one last question/i })).toBeNull();
    expect(screen.getByText(/answer the last question above/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /generate profile/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('once the last question is answered, the hint goes away', () => {
    const CANNED = "I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words.";
    setup([
      { role: 'assistant', content: 'Opening question?' },
      { role: 'user', content: CANNED },
      { role: 'assistant', content: 'Last: how do students revise?' },
      { role: 'user', content: 'They redo the run.' },
    ]);
    expect(screen.getByRole('button', { name: /generate profile/i })).toBeTruthy();
    expect(screen.queryByText(/answer the last question above/i)).toBeNull();
  });
});
