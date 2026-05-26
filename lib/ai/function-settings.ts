/**
 * Per-function AI model selection.
 *
 * Each AI call site in the system declares a `functionId`. The provider
 * factory looks up that ID against the ai_function_settings table to
 * decide which model to use. When no setting exists for an ID, the
 * function's compiled-in default tier applies.
 *
 * Tiers are an indirection layer so swapping the underlying model for a
 * tier (e.g., when a new "default" model ships) doesn't require updating
 * every call site or every settings row.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { aiFunctionSettings } from '@/lib/db/schema';

export const AI_FUNCTION_IDS = [
  'capture-chat',
  'capture-scores',
  'materials-analysis',
  'explore-draft-target',
  'explore-compare',
  'explore-what-if',
  'program-score-coverage',
  'decompose-prereq-gap',
  'material-summary',
] as const;
export type AIFunctionId = (typeof AI_FUNCTION_IDS)[number];

export type ModelTier = 'light' | 'default' | 'heavy' | 'custom';

/**
 * Tier → model mapping. The single place to change when a new generation
 * model ships and you want everyone on the 'default' tier to move forward.
 *
 * 'custom' tier ignores this map and uses the customModel column instead.
 */
export const TIER_TO_MODEL: Record<Exclude<ModelTier, 'custom'>, string> = {
  light: 'gpt-5.4-mini',
  default: 'gpt-5.4',
  heavy: 'gpt-5.5',
};

/**
 * Default tier per function. The starting point a fresh deployment uses
 * when no settings row exists. Faculty can override per-function from the
 * settings page.
 *
 * Rationale per function:
 *   - capture-chat: light. Turn-by-turn conversation, mostly summarization
 *     and targeted follow-up questions; structured-output JSON schema does
 *     the format heavy lifting.
 *   - capture-scores: default. Drives every downstream view; structured
 *     output but with rich reasoning across the whole audit transcript.
 *   - materials-analysis: light. Per-file extraction is bounded.
 *   - explore-draft-target: light. First draft only; instructor edits.
 *   - explore-compare: default. Multi-step reasoning across snapshot + spec.
 *   - explore-what-if: heavy. Hypothetical cascade reasoning; exactly where
 *     bigger reasoning earns its keep.
 *   - program-score-coverage: light. Mapping snapshot competencies to
 *     canonical sub-competencies — pattern-matching plus modest reasoning.
 *     Pilot at light; promote if quality is insufficient.
 *   - material-summary: light. One short summarization pass per long
 *     reference material at extraction time; cached on the row.
 */
export const DEFAULT_TIERS: Record<AIFunctionId, Exclude<ModelTier, 'custom'>> = {
  'capture-chat': 'light',
  'capture-scores': 'default',
  'materials-analysis': 'light',
  'explore-draft-target': 'light',
  'explore-compare': 'default',
  'explore-what-if': 'heavy',
  'program-score-coverage': 'light',
  // Small per-click transformation — one short gap → up to ~12 short
  // competency rows. Light tier handles this well; promote to default
  // if the decomposition quality is poor on long/aggregated gaps.
  'decompose-prereq-gap': 'light',
  'material-summary': 'light',
};

export const FUNCTION_LABELS: Record<AIFunctionId, string> = {
  'capture-chat': 'Capture audit conversation',
  'capture-scores': 'Capture scoring (Generate Profile)',
  'materials-analysis': 'Materials AI analysis (per-file)',
  'explore-draft-target': 'Explore — draft custom target from prose',
  'explore-compare': 'Explore — compare snapshot to target',
  'explore-what-if': 'Explore — what-if simulation',
  'program-score-coverage': 'Program coverage scoring',
  'decompose-prereq-gap': 'Decompose prereq gap into competencies (copy-as-KUD)',
  'material-summary': 'Material summary (for audit compression)',
};

export const FUNCTION_DESCRIPTIONS: Record<AIFunctionId, string> = {
  'capture-chat': "The auditor's per-turn replies during a capture conversation.",
  'capture-scores': 'Producing the structured Course Outcome Profile from the audit transcript.',
  'materials-analysis': 'AI analysis of an uploaded PDF / DOCX during the materials phase.',
  'explore-draft-target': 'Translating an instructor\'s prose goal into a structured custom target.',
  'explore-compare': "Running the comparator against a snapshot + target to produce alignment + recommendations.",
  'explore-what-if': 'Predicting the effect of a hypothetical change on the snapshot\'s competencies.',
  'program-score-coverage': 'Scoring each captured snapshot against each career target\'s sub-competencies for the program coverage matrix.',
  'decompose-prereq-gap': 'Decomposing one free-form prereq-gap finding into a structured list of competencies with K/U/D depths, for the copy-as-KUD button in the review panel.',
  'material-summary': 'Per-material structured summary, generated at extraction time for long reference materials and substituted for the full extracted text in the audit chat prompt.',
};

interface CachedSetting {
  tier: ModelTier;
  customModel: string | null;
  fetchedAt: number;
}

// Lightweight in-process cache. Settings change rarely; we trade fresh-on-
// every-call for fresh-on-every-60-seconds and avoid hammering Postgres.
const SETTING_TTL_MS = 60_000;
const settingsCache = new Map<AIFunctionId, CachedSetting>();

/**
 * Returns the resolved model name for a function — the row's customModel
 * (when tier === 'custom') or the tier's default model, or the function's
 * compiled-in default tier model when no row exists.
 */
export async function resolveModelForFunction(functionId: AIFunctionId): Promise<string> {
  const now = Date.now();
  const cached = settingsCache.get(functionId);
  if (cached && now - cached.fetchedAt < SETTING_TTL_MS) {
    return resolveFromTier(functionId, cached.tier, cached.customModel);
  }

  let row: { tier: string; customModel: string | null } | null = null;
  try {
    const rows = await db
      .select({ tier: aiFunctionSettings.tier, customModel: aiFunctionSettings.customModel })
      .from(aiFunctionSettings)
      .where(eq(aiFunctionSettings.functionId, functionId))
      .limit(1);
    row = rows[0] ?? null;
  } catch {
    // DB unreachable — fall back to defaults rather than erroring the call.
    row = null;
  }

  if (row) {
    const tier = row.tier as ModelTier;
    settingsCache.set(functionId, { tier, customModel: row.customModel, fetchedAt: now });
    return resolveFromTier(functionId, tier, row.customModel);
  }
  // No row — use the function's default tier.
  const defaultTier = DEFAULT_TIERS[functionId];
  settingsCache.set(functionId, { tier: defaultTier, customModel: null, fetchedAt: now });
  return TIER_TO_MODEL[defaultTier];
}

function resolveFromTier(
  functionId: AIFunctionId,
  tier: ModelTier,
  customModel: string | null,
): string {
  if (tier === 'custom' && customModel && customModel.trim().length > 0) {
    return customModel.trim();
  }
  if (tier === 'light' || tier === 'default' || tier === 'heavy') {
    return TIER_TO_MODEL[tier];
  }
  // Unknown tier value — fall back to the function's default.
  return TIER_TO_MODEL[DEFAULT_TIERS[functionId]];
}

/**
 * Call this when settings change so the next AI call picks up the new value
 * within the TTL window. Exported separately so the settings PUT endpoint
 * can invalidate without doing a DB roundtrip.
 */
export function invalidateSettingsCache(functionId?: AIFunctionId): void {
  if (functionId) settingsCache.delete(functionId);
  else settingsCache.clear();
}

export interface FunctionSettingRow {
  functionId: AIFunctionId;
  tier: ModelTier;
  customModel: string | null;
  resolvedModel: string;
  defaultTier: Exclude<ModelTier, 'custom'>;
}

/** Read all settings rows + each function's default tier + the model that
 * would be used right now. Used by the settings UI to populate the form. */
export async function listAllFunctionSettings(): Promise<FunctionSettingRow[]> {
  let rows: { functionId: string; tier: string; customModel: string | null }[] = [];
  try {
    rows = await db
      .select({
        functionId: aiFunctionSettings.functionId,
        tier: aiFunctionSettings.tier,
        customModel: aiFunctionSettings.customModel,
      })
      .from(aiFunctionSettings);
  } catch {
    rows = [];
  }
  const byId = new Map(rows.map(r => [r.functionId, r]));

  return AI_FUNCTION_IDS.map(functionId => {
    const stored = byId.get(functionId);
    const defaultTier = DEFAULT_TIERS[functionId];
    const tier = (stored?.tier as ModelTier | undefined) ?? defaultTier;
    const customModel = stored?.customModel ?? null;
    const resolvedModel = resolveFromTier(functionId, tier, customModel);
    return {
      functionId,
      tier,
      customModel,
      resolvedModel,
      defaultTier,
    };
  });
}

export interface UpsertFunctionSettingInput {
  functionId: AIFunctionId;
  tier: ModelTier;
  customModel: string | null;
}

export async function upsertFunctionSetting(input: UpsertFunctionSettingInput): Promise<void> {
  const existing = await db
    .select({ functionId: aiFunctionSettings.functionId })
    .from(aiFunctionSettings)
    .where(eq(aiFunctionSettings.functionId, input.functionId))
    .limit(1);
  const now = new Date();
  if (existing.length === 0) {
    await db.insert(aiFunctionSettings).values({
      functionId: input.functionId,
      tier: input.tier,
      customModel: input.tier === 'custom' ? input.customModel : null,
      updatedAt: now,
    });
  } else {
    await db
      .update(aiFunctionSettings)
      .set({
        tier: input.tier,
        customModel: input.tier === 'custom' ? input.customModel : null,
        updatedAt: now,
      })
      .where(eq(aiFunctionSettings.functionId, input.functionId));
  }
  invalidateSettingsCache(input.functionId);
}

export async function resetFunctionSetting(functionId: AIFunctionId): Promise<void> {
  await db.delete(aiFunctionSettings).where(eq(aiFunctionSettings.functionId, functionId));
  invalidateSettingsCache(functionId);
}
