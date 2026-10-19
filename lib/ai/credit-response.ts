import { NextResponse } from 'next/server';
import { AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE, creditsContact } from './credit-status';

/** 503 JSON for faculty-facing routes when the shared OpenAI credits are used up; null for any other error. */
export function creditsExhaustedResponse(err: unknown): NextResponse | null {
  if (!(err instanceof AiCreditsExhaustedError)) return null;
  return NextResponse.json(
    { error: 'ai_credits_exhausted', message: CREDITS_EXHAUSTED_MESSAGE(creditsContact()) },
    { status: 503 },
  );
}
