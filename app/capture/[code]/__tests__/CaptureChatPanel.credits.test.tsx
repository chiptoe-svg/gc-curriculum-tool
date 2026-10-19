import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaptureChatPanel } from '../CaptureChatPanel';
import { apiErrorText } from '@/lib/ai/credit-client';

Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;

const MSG = "The AI interview is paused because Clemson's shared OpenAI credits are used up. Your saved work is safe. Chip Tonkin has been notified — please try again later.";

describe('apiErrorText', () => {
  it('uses message for the credits code, error otherwise, fallback last', () => {
    expect(apiErrorText({ error: 'ai_credits_exhausted', message: MSG }, 'x')).toBe(MSG);
    expect(apiErrorText({ error: 'agent loop failed' }, 'x')).toBe('agent loop failed');
    expect(apiErrorText({}, 'fallback')).toBe('fallback');
  });
});

describe('CaptureChatPanel — credits exhausted', () => {
  it('shows the friendly message, not the raw code, on a 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ai_credits_exhausted', message: MSG }), { status: 503, headers: { 'content-type': 'application/json' } })));
    render(
      <CaptureChatPanel courseCode="GC 4060" slug="" messages={[{ role: 'assistant', content: 'Hi\n\nQ?' }]}
        onMessagesChange={vi.fn()} onGenerate={vi.fn()} chooserInstructor="T" onInstructorChange={vi.fn()}
        chooserMode="fresh" onModeChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'my answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText(MSG)).toBeInTheDocument());
    expect(screen.queryByText('ai_credits_exhausted')).toBeNull();
    vi.unstubAllGlobals();
  });
});
