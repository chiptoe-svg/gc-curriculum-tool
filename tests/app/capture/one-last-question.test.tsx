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

  function setup() {
    render(
      <CaptureChatPanel
        courseCode="GC 2400"
        slug="s"
        messages={[{ role: 'assistant', content: 'Opening question?' }]}
        onMessagesChange={() => {}}
        onGenerate={() => {}}
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

  it('clicking "Ask me one more important question" sends the canned turn', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /one more important question/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = String(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body,
    );
    expect(body).toMatch(/single most important question still missing/i);
  });
});
