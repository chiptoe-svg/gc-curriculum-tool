import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
vi.mock('@/components/VoiceRecorder', () => ({ VoiceRecorder: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Instructor A'] }));

import { CaptureChatPanel } from '@/app/capture/[code]/CaptureChatPanel';

const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status });
function chatStream(): Response {
  const ev = { kind: 'final', response: { finding: 'ok', question: '', citations: [], readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false } } };
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(ev) + '\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

describe('CaptureChatPanel sends added files', () => {
  it('appends pending and unreadable markers to the posted text and clears the chips', async () => {
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/chat')) { posted.push(String(init?.body)); return chatStream(); }
      if (init?.method === 'POST') {
        const name = ((init.body as FormData).get('file') as File).name;
        return json({ id: name === 'A.pdf' ? 'mA' : 'mB', fileName: name, indexingStatus: 'queued', duplicateOf: null });
      }
      if (u.includes('id=mB')) return json({ id: 'mB', indexingStatus: 'failed', extractionStatus: 'failed' });
      return json({ id: 'mA', indexingStatus: 'indexing', extractionStatus: 'ready' });
    }));
    render(
      <CaptureChatPanel courseCode="GC 2400" slug="s" messages={[{ role: 'assistant', content: 'Q?' }]} onMessagesChange={() => {}}
        onGenerate={() => {}} sessionId="s1" onSessionIdChange={() => {}} chooserInstructor="Instructor A"
        onInstructorChange={() => {}} chooserMode="fresh" onModeChange={() => {}} />,
    );
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    for (const n of ['A.pdf', 'B.pdf']) {
      fireEvent.change(input, { target: { files: [new File(['x'], n, { type: 'application/pdf' })] } });
      await waitFor(() => screen.getByLabelText(`Remove ${n}`));
    }
    await waitFor(() => screen.getByText('Could not read this file'), { timeout: 8000 });
    fireEvent.change(screen.getByPlaceholderText(/type a reply/i), { target: { value: 'here you go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posted.length).toBe(1));
    const msg = (JSON.parse(posted[0]!) as { message: string }).message;
    expect(msg).toContain('here you go');
    expect(msg).toContain('Instructor added a file: A.pdf (id=mA) — search it before answering.] (still being read)');
    expect(msg).toContain('Instructor added a file: B.pdf (id=mB) — it could not be read');
    expect(screen.queryByLabelText('Remove A.pdf')).toBeNull();
    expect(screen.queryByLabelText('Remove B.pdf')).toBeNull();
  }, 15000);
});
