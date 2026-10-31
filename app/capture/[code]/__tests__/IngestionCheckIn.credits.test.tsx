import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IngestionCheckIn } from '../IngestionCheckIn';

const MSG = "The AI interview is paused because Clemson's shared OpenAI credits are used up. Your saved work is safe. Chip Tonkin has been notified — please try again later.";

afterEach(() => vi.unstubAllGlobals());

describe('IngestionCheckIn — credits exhausted', () => {
  it('shows the credits message as an alert instead of rendering nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ai_credits_exhausted', message: MSG }), { status: 503, headers: { 'content-type': 'application/json' } })));
    render(<IngestionCheckIn courseCode="GC 4060" slug="" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(MSG));
  });

  it('other failures still render nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } })));
    const { container } = render(<IngestionCheckIn courseCode="GC 4060" slug="" />);
    await new Promise(r => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
