/**
 * Defense-in-depth PII redaction for LLM-generated profile text rendered on the
 * PUBLIC, unauthenticated /view/<code> surface.
 *
 * The capture pipeline already keeps FERPA-high material out of the model
 * (see lib/capture/finalize-extraction.ts), so model output should not contain
 * student identifiers. This is the belt-and-suspenders layer: if a name, CUID,
 * or email ever does slip into a generated field (strongest_evidence, narrative,
 * per-competency evidence, catalog deltas), scrub it before it reaches an
 * anonymous reader. Authenticated faculty surfaces render the un-redacted text.
 *
 * Scope: catches structured identifiers (Clemson CUIDs, email addresses) and
 * the "Submitted by / Posted by <Name>" attribution shape. It does NOT catch a
 * bare person name with no surrounding cue — that residual is mitigated by the
 * upstream content gate, not by this regex.
 */

const REDACTION = '[redacted]';

const CUID = /\bC\d{8}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// "Submitted by Jane Smith" / "Posted by Alex Kim" → keep the verb, drop the name.
const ATTRIBUTED_NAME = /\b(Submitted|Posted)\s+by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z'’\-]+)+/g;

/** Redact PII identifiers from a single string. */
export function redactPii(text: string): string {
  return text
    .replace(ATTRIBUTED_NAME, `$1 by ${REDACTION}`)
    .replace(CUID, REDACTION)
    .replace(EMAIL, REDACTION);
}

/**
 * Deep-redact every string value in an arbitrary JSON-shaped value, returning a
 * new structure (the input is not mutated). Keys are left untouched; only string
 * values are scrubbed.
 */
export function redactPiiDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactPii(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => redactPiiDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPiiDeep(v);
    }
    return out as T;
  }
  return value;
}
