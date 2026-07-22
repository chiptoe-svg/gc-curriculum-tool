import OpenAI from 'openai';
import { openAIBaseURL } from './openai-base-url';

/**
 * Lists chat-completion-capable models available to the configured OpenAI
 * API key. Filters out embeddings, audio, image, vision-preview, search,
 * realtime, transcribe, and dated point-in-time variants — leaving the
 * canonical short names a faculty member would actually want to pick.
 *
 * Result is cached in-process for 5 minutes so the settings UI doesn't
 * roundtrip to OpenAI on every page load.
 */

const TTL_MS = 5 * 60 * 1000;
const CHAT_MODEL_PREFIXES = ['gpt-', 'o1', 'o3', 'o4'];

// Models matching any of these patterns are excluded. Embedding / audio /
// image / search / realtime models aren't useful for our chat-completion
// + structured-output flows.
const EXCLUDE_PATTERNS: RegExp[] = [
  /embed/i,
  /whisper/i,
  /tts/i,
  /dall-?e/i,
  /-image|^gpt-image/i,    // image-generation models (gpt-image-2 etc.)
  /-instruct$/i,
  /-audio/i,
  /-search/i,
  /-realtime/i,
  /-transcribe/i,
  /moderation/i,
  /chatgpt-/i,         // ChatGPT product variants, not API-clean models
  /-\d{4}-\d{2}-\d{2}$/,  // dated point-in-time variants — keep the canonical
  /-preview$/i,
  /davinci|babbage|curie|ada/i,  // legacy completions models
];

interface CachedModelList {
  models: string[];
  fetchedAt: number;
}

let cache: CachedModelList | null = null;

export interface ListModelsResult {
  models: string[];
  stale: boolean;            // true when a fetch failed and we returned cached
  fetchedAt: number;
}

function isChatModel(id: string): boolean {
  if (!CHAT_MODEL_PREFIXES.some(p => id.startsWith(p))) return false;
  if (EXCLUDE_PATTERNS.some(re => re.test(id))) return false;
  return true;
}

/**
 * Compare two model IDs so that the more useful one comes first:
 *   - Higher major version (gpt-5 before gpt-4 before gpt-3)
 *   - Higher minor version (gpt-5.4 before gpt-5.3)
 *   - Non-mini before mini before nano (the "biggest" variant first)
 *   - Then alphabetical tiebreaker
 */
function compareModels(a: string, b: string): number {
  // Extract a (major, minor) tuple if present (e.g. "gpt-5.4" → [5, 4]).
  const aVer = a.match(/^(?:gpt-|o)(\d+)(?:\.(\d+))?/);
  const bVer = b.match(/^(?:gpt-|o)(\d+)(?:\.(\d+))?/);
  if (aVer && bVer) {
    const aMaj = parseInt(aVer[1] ?? '0', 10);
    const bMaj = parseInt(bVer[1] ?? '0', 10);
    if (aMaj !== bMaj) return bMaj - aMaj;
    const aMin = parseInt(aVer[2] ?? '0', 10);
    const bMin = parseInt(bVer[2] ?? '0', 10);
    if (aMin !== bMin) return bMin - aMin;
  }
  // Bigger variants before smaller within the same version.
  const sizeRank = (m: string) => {
    if (m.includes('nano')) return 3;
    if (m.includes('mini')) return 2;
    return 1;
  };
  const sizeDiff = sizeRank(a) - sizeRank(b);
  if (sizeDiff !== 0) return sizeDiff;
  return a.localeCompare(b);
}

export async function listAvailableChatModels(): Promise<ListModelsResult> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return { models: cache.models, stale: false, fetchedAt: cache.fetchedAt };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (cache) return { models: cache.models, stale: true, fetchedAt: cache.fetchedAt };
    throw new Error('OPENAI_API_KEY not set');
  }
  const client = new OpenAI({ apiKey, baseURL: openAIBaseURL() });

  try {
    const ids: string[] = [];
    for await (const m of client.models.list()) {
      if (m.id && isChatModel(m.id)) ids.push(m.id);
    }
    ids.sort(compareModels);
    cache = { models: ids, fetchedAt: now };
    return { models: ids, stale: false, fetchedAt: now };
  } catch (e) {
    if (cache) return { models: cache.models, stale: true, fetchedAt: cache.fetchedAt };
    throw e;
  }
}

export function invalidateModelsCache(): void {
  cache = null;
}
