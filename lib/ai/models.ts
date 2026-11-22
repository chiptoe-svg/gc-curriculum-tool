/**
 * Model registry: the one place that names OpenAI models.
 *
 * - ROLE_SETTINGS: which model and effort each role (judge / converse / write / extract) runs.
 *   Per-function roles and custom models live in `ai_function_settings`
 *   (lib/ai/function-settings.ts, edited on /settings).
 * - Prices live in lib/ai/prices.ts (one dated price list).
 * - DEFAULT_REASONING_EFFORT: effort a model runs at when the caller sets none.
 * - usesResponsesApi: which models take tool calls through the Responses API.
 *
 * To try a new model: add its price here, then point a role (or one
 * function's settings row) at it. A guard test
 * (lib/ai/__tests__/model-registry.test.ts) fails if a model id is written
 * anywhere else in lib/ or app/.
 */

/**
 * Roles group functions by the kind of work they do (spec
 * docs/superpowers/specs/2026-10-27-model-roles-design.md). Each role
 * carries a model and a reasoning effort; change them only here.
 * gpt-6.1-sol at low effort: owner decision 2026-10-06, see
 * docs/superpowers/audits/2026-10-05-model-evaluation.md. Converse moved to
 * medium effort (owner, 2026-10-27): at low effort the interviewer almost never
 * searched course materials, so it cited them about 10-20x less than the
 * summer interviews; at medium it searched and cited at 3 of 3 replayed turns.
 */
export type ModelRole = 'judge' | 'converse' | 'write' | 'extract';

export const MODEL_ROLES: readonly ModelRole[] = ['judge', 'converse', 'write', 'extract'];

/** Where a role's model runs: OpenAI (through the RCD gateway) or a campus RCD model. */
export type RoleProvider = 'openai' | 'campus';

export interface RoleSetting {
  model: string;
  /** OpenAI reasoning effort, or the campus reasoning level when provider is 'campus'. */
  effort: string | undefined;
  provider: RoleProvider;
  label: string;
  purpose: string;
}

/**
 * Campus (RCD) models by exact id. Never the moving aliases (tiger, cub):
 * they change model without notice (Part 2 spec, 2026-11-01).
 */
export const CAMPUS_MODELS = ['qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017', 'glm-5.3', 'gptoss-120b'] as const;

/**
 * OpenAI models /settings offers by default (owner, 2026-11-20): the ones in use or tested here, plus the newest
 * marked "not tested here". Everything else the gateway lists stays behind a "show everything" switch
 * (lib/ai/model-catalog.ts).
 */
export const VETTED_OPENAI_MODELS: ReadonlyArray<{ id: string; note: string | null }> = [
  { id: 'gpt-6.1-sol', note: null },
  { id: 'gpt-6.1-terra', note: null },
  { id: 'gpt-6.2-sol', note: 'not tested here' },
  { id: 'gpt-6.2-astra', note: 'not tested here' },
  { id: 'gpt-5.4-mini', note: null },
  { id: 'gpt-5.4-nano', note: null },
];

export function isCampusModel(id: string): boolean {
  return (CAMPUS_MODELS as readonly string[]).includes(id);
}

export const ROLE_SETTINGS: Record<ModelRole, RoleSetting> = {
  judge: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'low', label: 'Judge', purpose: 'Produces a score or claim that becomes the stored record' },
  converse: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'medium', label: 'Converse', purpose: 'Faculty-facing chat, turn by turn, often with tools' },
  write: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'low', label: 'Write', purpose: 'Prose or proposals a person reads or approves' },
  extract: { provider: 'openai', model: 'gpt-5.4-mini', effort: undefined, label: 'Extract', purpose: 'Bounded extraction, classification or summary, often in bulk' },
};

/**
 * Reasoning effort a model runs at when the caller sets none. Owner decision
 * 2026-10-06: gpt-6.1-sol runs at low (the 2026-10-05 evaluation and blind
 * evidence check: as consistent as medium/high, closest to the evidence,
 * cheapest). Models not listed get no reasoning_effort, so their requests
 * are unchanged. gpt-6.1-terra runs at medium (owner 2026-11-19: Terra medium for the interview;
 * the GC 3400 blind review ran it at medium). Without this, a custom Terra setting carries no effort
 * and the Pi loop would send none.
 */
export const DEFAULT_REASONING_EFFORT: Record<string, string> = { 'gpt-6.1-sol': 'low', 'gpt-6.1-terra': 'medium' };

/** gpt-6* models 400 on Chat Completions when function tools are present, so
 * tool-using calls go through the stateless Responses API for them. */
export function usesResponsesApi(model: string): boolean {
  return /^gpt-6/.test(model);
}
