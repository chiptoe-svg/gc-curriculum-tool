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
  'material-digest',
  'chunk-contextualize',
  'ingestion-checkin',
  'capture-chat-agent',
  'wiki-update',
  'curriculum-chat',
  'capture-stress-test',
  'jd-extract',
  'position-rated-items',
  'position-interview-agent',
  'position-synthesis',
  'prereq-edge-seed',
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
 *   - capture-chat: default. Started on light (gpt-5.4-mini), but real
 *     courses can dump 300k+ tokens of materials into the bundle and the
 *     mini's 272k input cap kept rejecting fresh sessions. Default tier
 *     (gpt-5.4) has the larger window and the audit's judgement quality
 *     benefits from it too.
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
 */
export const DEFAULT_TIERS: Record<AIFunctionId, Exclude<ModelTier, 'custom'>> = {
  'capture-chat': 'default',
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
  // Light per-material digest generated at extraction time for every material.
  // Loaded into the audit agent's at-rest context. Light tier is appropriate —
  // one summarization pass per material; promote if output quality is poor.
  'material-digest': 'light',
  // Light per-chunk position blurb generated at extraction time for every
  // detail chunk. Prepended before embedding so the vector encodes position +
  // content (Anthropic contextual-retrieval pattern). Light tier is correct —
  // one short summarization call per chunk; promote if output quality is poor.
  'chunk-contextualize': 'light',
  // Light pre-audit curation review. One call per page open; either silent or
  // emits a short heads-up panel about missing core sources, stacked
  // auto-set-asides, kept high-FERPA risk, or near-empty digest clusters.
  'ingestion-checkin': 'light',
  // Stage 3 tool-using auditor. Drives the per-turn agent loop in
  // CourseCapture v2: reads at-rest digests, retrieves chunks on demand,
  // emits a structured finding/question/citations response. Default tier —
  // same reasoning load as 'capture-chat' but with tool routing on top.
  'capture-chat-agent': 'default',
  // Wiki-layer regeneration on snapshot creation. Synthesizes 5–15 affected
  // markdown pages (course, competencies, targets, concepts) from the new
  // snapshot + related Postgres substrate. Heavy tier — quality matters more
  // than cost here; a well-written wiki page may be read dozens of times.
  // Estimated ~$1–3 per snapshot at scale.
  'wiki-update': 'heavy',
  // Conversational layer over the wiki — tool-using agent that reads, lists,
  // and searches the curated narrative corpus to answer faculty questions.
  // Default tier: same reasoning load as capture-chat-agent (read context,
  // route 1-3 tool calls, synthesize an evidence-cited response).
  'curriculum-chat': 'default',
  // Heavy tier. Adversarial review of a produced profile: read all
  // competencies + audit_notes + verification_summary + the full
  // transcript + materials and challenge per-finding confidence,
  // surface internal contradictions, and flag catalog-vs-evidence
  // claims that don't hold up. This is exactly the kind of cross-
  // referenced critical-reasoning task where heavy-tier reasoning
  // is the value. One call per stress-test click; not auto-on-generate.
  'capture-stress-test': 'heavy',
  // Light tier. One-shot LLM call that reads an extracted JD (Docling
  // markdown or pasted text) and emits structured fields with per-field
  // confidence scores. Small input, structured output, cheap.
  'jd-extract': 'light',
  // Default tier. Reads pages 1-4 + career target sub-comps and emits
  // 10 "experiences worth having" candidates. Single-call generator.
  'position-rated-items': 'default',
  // Default tier. Page 6 per-turn loop — anchor-probe-confirm posture.
  // Reads pages 1-5 context; emits AuditResponse-shaped per-turn output.
  'position-interview-agent': 'default',
  // Default tier. Synthesis over a completed Page 6 interview transcript
  // + the upstream page inputs. Emits a PositionProfile.
  'position-synthesis': 'default',
  // Default tier. Structured extraction over free-text prerequisites prose +
  // the sub-competency catalog — proposes direct skill-tagged edges with
  // expected K/U/D depths grounded in incoming-expectation statements.
  // Default (not light) because it must reason across the full sub-comp
  // catalog + match catalog ids precisely to avoid hallucinated join keys.
  'prereq-edge-seed': 'default',
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
  'material-digest': 'Material digest (every material, audit at-rest context)',
  'chunk-contextualize': 'Chunk contextualizer (per-chunk position blurb)',
  'ingestion-checkin': 'Ingestion check-in (materials curation review)',
  'capture-chat-agent': 'Audit chat agent (Stage 3 — tool-using auditor)',
  'wiki-update': 'Wiki page regeneration (on snapshot creation)',
  'curriculum-chat': 'Curriculum chat (Explore "Ask" tab + future /ask)',
  'capture-stress-test': 'Capture stress test (adversarial profile review)',
  'jd-extract': 'JD field extraction',
  'position-rated-items': 'Position rated-items generator',
  'position-interview-agent': 'Position interview agent',
  'position-synthesis': 'Position interview synthesis',
  'prereq-edge-seed': 'Prerequisite edge seeder',
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
  'material-digest': 'Per-material structured digest, generated at extraction for every material. Loaded into the audit agent\'s at-rest context.',
  'chunk-contextualize': 'One short positional blurb per detail chunk, prepended before embedding so the embedding encodes position + content.',
  'ingestion-checkin': 'Reviews the curated materials state before audit chat begins and emits either a short heads-up panel or silence.',
  'capture-chat-agent': 'Per-turn agent loop for CourseCapture v2 audit chat; reads at-rest digests, retrieves chunks on demand, emits a structured finding + question + citations.',
  'wiki-update': 'Regenerates the affected wiki-layer pages (course, competencies, targets, concepts) from a new snapshot + related substrate. Returns a page map; Task A3 git-ops writes + commits.',
  'curriculum-chat': 'Faculty-facing chat over the curriculum wiki. Tool-using agent reads / lists / searches wiki pages and emits a markdown response with structured page citations. Powers Explore\'s "Ask" tab and the future standalone /ask route.',
  'capture-stress-test': 'Adversarial review of a produced Course Outcome Profile: challenges per-finding confidence, surfaces internal contradictions, flags catalog-vs-evidence claims that don\'t hold up. Heavy reasoning tier; one call per on-demand stress-test click.',
  'jd-extract': 'One-shot extraction of structured fields from a job description (Docling markdown or pasted text), with per-field confidence scores.',
  'position-rated-items': 'Generates 10 "experiences worth having" candidates from pages 1-4 inputs + career target sub-competencies. Single-call generator.',
  'position-interview-agent': 'Per-turn interview agent for page 6 of Position Capture; anchor-probe-confirm posture using pages 1-5 context. Emits AuditResponse-shaped output.',
  'position-synthesis': 'Synthesis over a completed page 6 interview transcript + upstream page inputs; produces a structured PositionProfile.',
  'prereq-edge-seed': 'Reads a focal course\'s free-text prerequisites + incoming-expectation statements + the catalog sub-competencies and proposes direct, skill-tagged prerequisite edges with expected K/U/D depths.',
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
