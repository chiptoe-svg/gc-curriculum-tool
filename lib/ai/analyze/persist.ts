import { insertRun, type InsertRunInput } from '@/lib/db/queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';

/**
 * Persists a successful analyze run and records spend. Returns the runId on
 * success, or null on persistence failure — losing the run log is preferable
 * to losing the user's analysis after the AI work has already been paid for.
 */
export async function persistAnalyzeRun(input: InsertRunInput): Promise<string | null> {
  try {
    const { id } = await insertRun(input);
    await recordSpend(input.costUsdCents);
    return id;
  } catch (err) {
    console.error('persistAnalyzeRun: persistence failed after successful AI calls', err);
    return null;
  }
}
