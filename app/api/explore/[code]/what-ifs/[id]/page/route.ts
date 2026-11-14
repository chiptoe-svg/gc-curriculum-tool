import { NextResponse } from 'next/server';
import { guardWhatIf } from '@/lib/what-if/route-guard';
import { createWhatIfPage } from '@/lib/what-if/create-page';
import { AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE, creditsContact } from '@/lib/ai/credit-status';

export const maxDuration = 300;

interface Ctx { params: Promise<{ code: string; id: string }> }

/**
 * POST /api/explore/[code]/what-ifs/[id]/page
 * Creates the what-if's page, or updates it from the conversation so far. The
 * previous page stays in place unless the whole run succeeds. Only the author
 * or an admin may run it.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;

  try {
    const result = await createWhatIfPage(g.whatIf);
    if (result.ok) return NextResponse.json({ ok: true });
    switch (result.reason) {
      case 'baseline_withdrawn':
        return NextResponse.json(
          // Same sentence and code as the scores route; `error` carries the text the client shows.
          { error: 'The approved version this revision started from was withdrawn. Start over to revise the current version.', code: 'baseline_withdrawn' },
          { status: 409 },
        );
      case 'daily_cap':
        return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });
      case 'prose_failed':
        return NextResponse.json({ error: 'The page text could not be written. Try again.' }, { status: 502 });
    }
  } catch (err) {
    if (err instanceof AiCreditsExhaustedError) {
      return NextResponse.json(
        { error: CREDITS_EXHAUSTED_MESSAGE(creditsContact()), code: 'ai_credits_exhausted' },
        { status: 503 },
      );
    }
    console.error('[what-if page]', err);
    return NextResponse.json({ error: 'The page could not be created. Try again.' }, { status: 502 });
  }
}
