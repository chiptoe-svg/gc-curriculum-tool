import { CREDITS_EXHAUSTED_MESSAGE, creditsContact, readCreditStatus } from '@/lib/ai/credit-status';

/** Server-rendered notice when Clemson's shared OpenAI credits are used up. Renders nothing otherwise. */
export async function CreditsBanner() {
  const s = await readCreditStatus();
  if (s?.status !== 'exhausted') return null;
  return (
    <div role="alert" data-testid="credits-banner" className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      {CREDITS_EXHAUSTED_MESSAGE(creditsContact())}
    </div>
  );
}
