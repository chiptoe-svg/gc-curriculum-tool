/**
 * Wiki handoff provider (project skill trail plan, Task 5b; owner decision
 * 2026-10-22): wiki pages written OUTSIDE the app — by Opus in a Claude Code
 * session — then checked and committed by the normal wiki pipeline.
 *
 * Round 1: each request (system prompt + user message) is written to
 * <dir>/requests/<key>.json and the call throws WikiHandoffPending, so the unit
 * fails exactly as an API failure would and nothing is committed for it.
 * Round 2: the same message finds <dir>/responses/<key>.json, which goes
 * through the caller's `validate` like any model reply. The key is the prompt
 * plus the requested page paths (see handoffKey). Use a fresh directory per
 * rollout: a reply is reused for the same pages for as long as the directory
 * exists. Zero cost is reported; no API is called.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AIProvider, CompletionTelemetry } from '@/lib/ai/provider';

export class WikiHandoffPending extends Error {
  constructor(public readonly requestPath: string) {
    super(`wiki handoff: reply pending — request written to ${requestPath}`);
    this.name = 'WikiHandoffPending';
  }
}

const ZERO: CompletionTelemetry = { costUsdCents: 0, durationMs: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 };

/**
 * Identity of a request: the system prompt plus the SET of requested page
 * paths. The rest of the message (a refresh timestamp, live sheet fields, the
 * pages' current wiki content) can change between round 1 and round 2, so it
 * is left out (final review C1/I1); a reconcile retry asks for fewer pages and
 * so gets its own key. A message that is not the wiki's JSON falls back to the
 * whole text.
 */
export function handoffKey(systemPrompt: string, userMessage: string): string {
  let identity = userMessage;
  try {
    const pages = (JSON.parse(userMessage) as { affectedWikiPages?: Array<{ path?: unknown }> }).affectedWikiPages;
    if (Array.isArray(pages)) identity = JSON.stringify(pages.map(p => String(p?.path)).sort());
  } catch { /* not JSON: whole message */ }
  return createHash('sha256').update(`${systemPrompt}\n${identity}`).digest('hex').slice(0, 16);
}

export class HandoffProvider implements Pick<AIProvider, 'complete'> {
  constructor(private readonly dir: string) {}

  async complete<T>(args: {
    systemPrompt: string; userMessage: string; schemaName: string; jsonSchema: object;
    validate: (raw: unknown) => T; documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const key = handoffKey(args.systemPrompt, args.userMessage);
    const responsePath = path.join(this.dir, 'responses', `${key}.json`);
    if (existsSync(responsePath)) {
      const raw: unknown = JSON.parse(readFileSync(responsePath, 'utf8'));
      return { data: args.validate(raw), ...ZERO };
    }
    const requestPath = path.join(this.dir, 'requests', `${key}.json`);
    mkdirSync(path.dirname(requestPath), { recursive: true });
    writeFileSync(requestPath, JSON.stringify({
      key, schemaName: args.schemaName, systemPrompt: args.systemPrompt, userMessage: args.userMessage, jsonSchema: args.jsonSchema,
    }, null, 2));
    throw new WikiHandoffPending(requestPath);
  }
}

type WikiCompleter = Pick<AIProvider, 'complete'>;

/** The wiki writer's provider: the handoff provider when WIKI_HANDOFF_DIR is set, else the configured one. */
export async function wikiProvider(configured: () => Promise<WikiCompleter>): Promise<WikiCompleter> {
  const dir = process.env.WIKI_HANDOFF_DIR?.trim();
  return dir ? new HandoffProvider(dir) : configured();
}
