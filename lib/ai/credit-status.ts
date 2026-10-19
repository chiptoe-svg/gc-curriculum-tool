/**
 * Shared OpenAI credit status (owner, 2026-10-19).
 *
 * All OpenAI traffic goes through Clemson RCD's gateway. When the shared credit
 * pool is used up every call fails with
 *   {"error":{"code":"quota_denied","message":"released OpenAI shared credits are exhausted",...}}
 * The gateway has no balance endpoint, so we learn about it two ways: passively
 * (a real request failed — markCreditsExhausted) and by the scheduled probe
 * (scripts/ai/credit-check.mjs). Both write the status file below; the faculty
 * banner reads it, and touching the trigger file makes launchd alert at once.
 *
 * Never throws from the mark/read helpers: a status write must not break an AI call.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SIGNIN_CONTACT } from '@/lib/auth/auth-env';

export type CreditState = 'ok' | 'exhausted' | 'unknown';
export interface CreditStatus {
  status: CreditState;
  since: string;
  checkedAt: string;
  source: 'probe' | 'request';
  detail: string;
  /** Consecutive probe results that could not tell (written by the probe script only). */
  unknownStreak?: number;
}

export class AiCreditsExhaustedError extends Error {
  readonly code = 'ai_credits_exhausted';
  constructor(message: string = CREDITS_EXHAUSTED_MESSAGE(creditsContact()), options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiCreditsExhaustedError';
  }
}

export function creditsContact(): string {
  return process.env.SIGNIN_CONTACT || DEFAULT_SIGNIN_CONTACT;
}

export function CREDITS_EXHAUSTED_MESSAGE(contact: string): string {
  return `The AI interview is paused because Clemson's shared OpenAI credits are used up. Your saved work is safe. ${contact} has been notified — please try again later.`;
}

const EXHAUSTED_TEXT = 'shared credits are exhausted';

function bodyHasExhausted(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('quota_denied') || v.includes(EXHAUSTED_TEXT);
  return false;
}

function matches(e: unknown): boolean {
  if (!e || typeof e !== 'object') return typeof e === 'string' && bodyHasExhausted(e);
  const o = e as Record<string, unknown>;
  const inner = (o.error && typeof o.error === 'object' ? o.error : null) as Record<string, unknown> | null;
  const data = (o.data && typeof o.data === 'object' ? o.data : null) as { error?: Record<string, unknown> } | null;
  if (o.code === 'quota_denied' || inner?.code === 'quota_denied' || data?.error?.code === 'quota_denied') return true;
  if (typeof o.message === 'string' && o.message.includes(EXHAUSTED_TEXT)) return true;
  if (typeof inner?.message === 'string' && inner.message.includes(EXHAUSTED_TEXT)) return true;
  return bodyHasExhausted(o.responseBody);
}

/**
 * True for the gateway's credits-exhausted failure, whichever client surfaced
 * it: the OpenAI SDK's APIError (`.code`, `.error`), the Vercel AI SDK's
 * APICallError (`.data.error`, `.responseBody`), or an error that wraps one
 * (`.cause`, RetryError `.lastError`/`.errors`).
 */
export function isCreditsExhaustedError(err: unknown, depth = 0): boolean {
  if (depth > 5 || err == null) return false;
  if (matches(err)) return true;
  if (typeof err !== 'object') return false;
  const o = err as { cause?: unknown; lastError?: unknown; errors?: unknown };
  if (isCreditsExhaustedError(o.cause, depth + 1) || isCreditsExhaustedError(o.lastError, depth + 1)) return true;
  return Array.isArray(o.errors) && o.errors.some(x => isCreditsExhaustedError(x, depth + 1));
}

const STATE_DIR = () => path.join(os.homedir(), '.local/state/gc-curriculum-tool');

/** Real paths are inert under tests unless the env override is set (same idea as requestPublicCopyRefresh). */
function resolvePath(envName: string, fallbackName: string): string | null {
  const override = process.env[envName];
  if (override) return override;
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  return path.join(STATE_DIR(), fallbackName);
}
const statusPath = () => resolvePath('AI_CREDITS_STATUS_FILE', 'ai-credits.json');
const triggerPath = () => resolvePath('AI_CREDITS_TRIGGER_FILE', 'ai-credits.trigger');

export async function readCreditStatus(): Promise<CreditStatus | null> {
  const file = statusPath();
  if (!file) return null;
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as Partial<CreditStatus>;
    if (j && (j.status === 'ok' || j.status === 'exhausted' || j.status === 'unknown') && typeof j.since === 'string') {
      return { status: j.status, since: j.since, checkedAt: j.checkedAt ?? j.since, source: j.source === 'probe' ? 'probe' : 'request', detail: j.detail ?? '' };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeStatus(file: string, s: CreditStatus): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // Atomic: write a private temp file, then rename into place, so a concurrent
  // reader never sees a half-written file.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2) + '\n');
  await rename(tmp, file);
}

export async function markCreditsExhausted(source: 'probe' | 'request', detail: string): Promise<void> {
  const file = statusPath();
  if (!file) return;
  try {
    const now = new Date().toISOString();
    const prev = await readCreditStatus();
    await writeStatus(file, {
      status: 'exhausted',
      since: prev?.status === 'exhausted' ? prev.since : now,
      checkedAt: now,
      source,
      detail,
    });
    // Touch the trigger only on the change to exhausted, not on every failed request.
    const trig = triggerPath();
    if (trig && prev?.status !== 'exhausted') await writeFile(trig, `${now}\n`);
  } catch (err) {
    console.error(`[ai credits] could not record exhausted status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function markCreditsOk(source: 'probe' | 'request'): Promise<void> {
  const file = statusPath();
  if (!file) return;
  try {
    const prev = await readCreditStatus();
    if (prev?.status === 'ok') return;
    const now = new Date().toISOString();
    await writeStatus(file, { status: 'ok', since: now, checkedAt: now, source, detail: '' });
  } catch (err) {
    console.error(`[ai credits] could not record ok status: ${err instanceof Error ? err.message : String(err)}`);
  }
}
