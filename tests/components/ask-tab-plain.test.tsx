import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AskTab } from '@/components/AskTab';

vi.mock('@/components/VoiceRecorder', () => ({ VoiceRecorder: () => null }));

// Pins the behavior of the plain AskTab (no courseCode) used by /ask and the wiki page.
const events = [
  { kind: 'text-delta', delta: '{"response":"raw structured' },
  {
    kind: 'final',
    response: {
      response: 'Brand strategy is anchored in GC 4400.',
      citations: [{ path: 'courses/gc-4400.md', courseCode: null, fileName: null, excerpt: 'integration studio' }],
    },
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => {
    const body = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    return {
      ok: true,
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      text: async () => '',
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

describe('AskTab without a course', () => {
  it('posts to /api/ask/chat, renders the answer and a citation, and has no "Asking about <course>" header', async () => {
    render(<AskTab slug="s" />);
    expect(screen.getByText(/Asking about the curriculum/)).toBeInTheDocument();
    expect(screen.queryByText(/Asking about GC/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Ask about the curriculum…'), { target: { value: 'Where is brand strategy?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Brand strategy is anchored in GC 4400.')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/ask/chat?slug=s');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      messages: [{ role: 'user', content: 'Where is brand strategy?' }],
    });
    // the raw streamed delta is not shown; the final answer is
    expect(screen.queryByText(/raw structured/)).toBeNull();
    // citation line, linked into the wiki
    expect(screen.getByRole('link', { name: 'courses/gc-4400' })).toHaveAttribute('href', '/wiki/courses/gc-4400?slug=s');
    expect(screen.getByText(/integration studio/)).toBeInTheDocument();
  });
});
