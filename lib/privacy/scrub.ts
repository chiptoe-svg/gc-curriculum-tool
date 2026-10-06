/**
 * Privacy scrub (spec docs/superpowers/specs/2026-10-05-privacy-scrub-design.md).
 *
 * Student-identifying data never enters a stored record. Called by the single
 * writer of course_materials.extracted_text (updateExtractionResult) and by the
 * single writer of wiki files (writeAndPush).
 *
 *   1. Deterministic, always: CUIDs -> [student ID]; emails -> [email] except
 *      in syllabi.
 *   2. AI name pass, only when needed: when the FERPA detector reports a
 *      name-shaped rule, or the file is Canvas: Discussions — and never for
 *      syllabi, which are public documents. The model returns only a LIST of
 *      the student names it finds; the code replaces those names in the input
 *      (lib/privacy/names.ts), so no other character of the text can change.
 *      A provider failure is retried once, then throws ScrubError — callers
 *      store nothing.
 */
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';
import { scrubIdentifiers, countRedactionMarkers } from './deterministic';
import { acceptNames, redactNames, splitForNamePass } from './names';
import type { RedactionKind } from './types';

export interface ScrubOptions { fileName: string; isSyllabus: boolean }
export interface ScrubResult { text: string; redactions: Record<RedactionKind, number> }

export class ScrubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrubError';
  }
}

const NAME_PASS_RULES = new Set(['submitted-by', 'posted-by', 'roster-names', 'gradebook']);
const NAME_PASS_CONCURRENCY = 4;

const OUTPUT_SCHEMA: object = {
  type: 'object',
  additionalProperties: false,
  required: ['names'],
  properties: { names: { type: 'array', items: { type: 'string' } } },
};

export function needsNamePass(text: string, fileName: string): boolean {
  if (fileName === 'Canvas: Discussions') return true;
  return detectFerpaRisk(text).matches.some(m => NAME_PASS_RULES.has(m.rule));
}

export async function scrubForRecord(text: string, opts: ScrubOptions): Promise<ScrubResult> {
  let out = scrubIdentifiers(text, { keepEmails: opts.isSyllabus });
  // The trigger is checked on the RAW text and on the ID/email-scrubbed text.
  // Raw: an email glued to a surname ("Submitted by Jane Doe@x.edu") becomes
  // "Submitted by Jane [email]", which no longer matches submitted-by. Scrubbed:
  // "[student ID]" cells read as a name-ish column, so a CUID + grade table is
  // gradebook-shaped only after replacement. Either signal runs the pass; the
  // rules themselves are unchanged (cuid/emails are not triggers).
  // Syllabi skip the name pass entirely: they are public documents (owner
  // ruling 2026-10-05), and the names in them are instructors and TAs.
  if (!opts.isSyllabus && (needsNamePass(text, opts.fileName) || needsNamePass(out, opts.fileName))) {
    out = await runNamePass(out);
  }
  return { text: out, redactions: countRedactionMarkers(out) };
}

async function runNamePass(text: string): Promise<string> {
  // Smaller chunks than the 6000 default: the model's recall drops on long, name-dense pieces.
  const chunks = splitForNamePass(text, 3000);

  // Dynamic imports: importing this module (via course-materials-queries)
  // must not load the AI SDKs for every DB caller. Resolved ONCE, before the
  // concurrent chunk loop below — issuing one `await import(...)` per worker
  // (there used to be one inside each chunk's call) raced the first,
  // not-yet-cached dynamic import of the same specifier across concurrent
  // workers and could each resolve a separate module instance.
  const [{ getProviderForFunction }, { loadPrompt }, { recordSpend }] = await Promise.all([
    import('@/lib/ai/provider'),
    import('@/lib/ai/prompts/load'),
    import('@/lib/rate-limit/daily-cap'),
  ]);
  const provider = await getProviderForFunction('privacy-scrub');
  const systemPrompt = await loadPrompt('privacy-scrub');

  // Several rounds per chunk, names unioned: a single model run is not
  // reliable on name-dense text (2026-10-06, GC 4900bl roster: one run listed
  // 62 names, the next 19). PRIVACY_SCRUB_ROUNDS overrides (tests use 1).
  const rounds = Math.max(1, Number(process.env.PRIVACY_SCRUB_ROUNDS ?? 3));
  const jobs = chunks.flatMap((chunk, idx) => Array.from({ length: rounds }, () => ({ chunk, idx })));
  const results = await mapWithConcurrency(jobs, NAME_PASS_CONCURRENCY, async ({ chunk, idx }) => {
    const where = `chunk ${idx + 1}/${chunks.length}`;
    // One retry per call (same pattern as chunkLlmComplete, commit edd59b6):
    // a provider blip would otherwise fail the whole material and store no
    // text. Only the second failure throws.
    try {
      return await scrubChunk(provider, systemPrompt, chunk, where, recordSpend);
    } catch (first) {
      const delayMs = Number(process.env.PRIVACY_SCRUB_RETRY_DELAY_MS ?? 60_000);
      // `first` is a ScrubError, whose message is text-free by construction.
      console.warn(`[privacy] ${(first as Error).message}; retrying in ${delayMs / 1000}s`);
      await new Promise(r => setTimeout(r, delayMs));
      return scrubChunk(provider, systemPrompt, chunk, where, recordSpend);
    }
  });
  // A name found in any chunk is replaced wherever it occurs in the material
  // (the model may miss a repeat of it in another chunk).
  const names = [...new Set(results.flatMap(r => r.accepted))];
  const ignored = results.reduce((n, r) => n + r.ignored, 0);
  // Counts only — never the names.
  if (ignored > 0) console.info(`[privacy] name pass ignored ${ignored} listed name(s) not found in the text`);
  return redactNames(text, names);
}

async function scrubChunk(
  provider: Awaited<ReturnType<typeof import('@/lib/ai/provider').getProviderForFunction>>,
  systemPrompt: string,
  chunk: string,
  where: string,
  recordSpend: typeof import('@/lib/rate-limit/daily-cap').recordSpend,
): Promise<{ accepted: string[]; ignored: number }> {
  let names: string[];
  try {
    names = await callPrivacyScrub(provider, systemPrompt, chunk, recordSpend);
  } catch (err) {
    // Never interpolate err.message here: providers sometimes echo raw
    // model/input content in their own error text (e.g. OpenAI's "returned
    // non-JSON content: <first 200 chars>"), and that content is material
    // text that may contain an unredacted name. This message is stored as
    // course_materials.redactions.failedReason and logged, so only a
    // text-free identifier of the error is allowed through.
    const why = err instanceof Error ? err.name : typeof err;
    throw new ScrubError(`privacy-scrub call failed on ${where} (${why})`);
  }
  return acceptNames(chunk, names);
}

async function callPrivacyScrub(
  provider: Awaited<ReturnType<typeof import('@/lib/ai/provider').getProviderForFunction>>,
  systemPrompt: string,
  chunk: string,
  recordSpend: typeof import('@/lib/rate-limit/daily-cap').recordSpend,
): Promise<string[]> {
  const result = await provider.complete<{ names: string[] }>({
    systemPrompt,
    userMessage: chunk,
    schemaName: 'privacy_scrub',
    jsonSchema: OUTPUT_SCHEMA,
    validate: (raw) => {
      const r = raw as { names?: unknown } | null;
      if (!r || !Array.isArray(r.names) || !r.names.every(n => typeof n === 'string')) {
        throw new Error('privacy-scrub: response has no names array');
      }
      return { names: r.names as string[] };
    },
  });
  // Spend is recorded but never blocked: skipping the pass would mean storing nothing.
  await recordSpend(result.costUsdCents);
  return result.data.names;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
