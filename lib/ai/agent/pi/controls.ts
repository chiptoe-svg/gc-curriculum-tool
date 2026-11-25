/**
 * The interview controls the Pi loop uses (Pi plan Task 1). One copy of each
 * rule: this re-exports lib/ai/agent/interview-controls.ts, which the current
 * loop uses too — the search trigger, the citation check, the citation repair
 * and the retry limits.
 */
export {
  MATERIAL_TOOLS, MAX_CITATION_RETRIES, MAX_SEARCH_RETRIES, SEARCH_TOOLS,
  needsMaterialSearch, previousQuestion, citableFromHistory, chunkIdsInToolResult,
  checkCitations, keepValidCitations, repairCitations, parseInterviewReply, citationFollowUp,
} from '@/lib/ai/agent/interview-controls';

/**
 * Pi 1.6's argument coercion turns a null in a string field into the text "null" (1.4 gave "") and a null array
 * into ["null"]. Run before validation (a tool's prepareArguments): null becomes "" where the schema says exactly
 * `string`, and [] where it says exactly `array`. Fields that allow null (type arrays such as ["string","null"])
 * are left alone. Returns the input itself when nothing changed.
 */
export function nullsToEmpty(args: unknown, schema: unknown): unknown {
  const s = (schema ?? {}) as { type?: unknown; properties?: Record<string, unknown>; items?: unknown };
  if (Array.isArray(args)) {
    if (s.items && typeof s.items === 'object' && !Array.isArray(s.items)) {
      let changed = false;
      const out = args.map(a => { const n = nullsToEmpty(a, s.items); if (n !== a) changed = true; return n; });
      return changed ? out : args;
    }
    return args;
  }
  if (args && typeof args === 'object' && s.properties) {
    const obj = args as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    for (const [key, sub] of Object.entries(s.properties)) {
      if (!(key in obj)) continue;
      const t = (sub as { type?: unknown } | null)?.type;
      let next: unknown = obj[key];
      if (next === null && t === 'string') next = '';
      else if (next === null && t === 'array') next = [];
      else next = nullsToEmpty(next, sub);
      if (next !== obj[key]) { out ??= { ...obj }; out[key] = next; }
    }
    return out ?? args;
  }
  return args;
}
