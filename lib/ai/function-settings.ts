/**
 * Per-function AI model selection.
 *
 * Each AI call site in the system declares a `functionId`. The provider
 * factory looks up that ID against the ai_function_settings table to
 * decide which model to use. When no setting exists for an ID, the
 * function's compiled-in role applies.
 *
 * Roles (lib/ai/models.ts) are an indirection layer so swapping the model
 * for a role doesn't require updating every call site or every settings row.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { aiFunctionSettings } from '@/lib/db/schema';
import { DEFAULT_REASONING_EFFORT, MODEL_ROLES, ROLE_SETTINGS, type ModelRole } from '@/lib/ai/models';

export const AI_FUNCTION_IDS = [
  'capture-chat',
  'capture-scores',
  'materials-analysis',
  'explore-local-delta',
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
  'intended-skills-extract',
  'parse-profile-fields',
  'extract-course-kud',
  'synthesize-target',
  'reconcile-feedback',
  'material-classify',
  'explore-agent',
  'objective-evidence-guide',
  'bundle-card-draft',
  'bundle-map-onet',
  'kud-chat',
] as const;
export type AIFunctionId = (typeof AI_FUNCTION_IDS)[number];

/**
 * What a settings row's `tier` column holds: a role, or 'custom' (use the
 * row's customModel). Rows written before 2026-10-27 may still hold the old
 * tier names light / default / heavy; resolveSetting maps them on read.
 */
export type StoredTier = ModelRole | 'custom';

/**
 * Compiled-in role per function, used when no settings row exists. Roles and
 * the reasons for each assignment: docs/superpowers/specs/2026-10-27-model-roles-design.md.
 * Earlier per-function tier history (e.g. why coverage scoring left the light
 * tier in June): docs/superpowers/audits/2026-06-12-reliability-study.md and
 * 2026-10-05-model-evaluation.md.
 */
export const DEFAULT_ROLES: Record<AIFunctionId, ModelRole> = {
  // Judge: produces a score or claim that becomes the stored record.
  'program-score-coverage': 'judge',
  'capture-scores': 'judge',
  'capture-stress-test': 'judge',
  'intended-skills-extract': 'judge',
  'prereq-edge-seed': 'judge',
  'bundle-map-onet': 'judge',
  'extract-course-kud': 'judge',
  // Converse: faculty-facing chat, turn by turn, often with tools.
  'capture-chat-agent': 'converse',
  'capture-chat': 'converse',
  'curriculum-chat': 'converse',
  'explore-agent': 'converse',
  'position-interview-agent': 'converse',
  'kud-chat': 'converse',
  // Write: prose or proposals a person reads or approves.
  'wiki-update': 'write',
  'objective-evidence-guide': 'write',
  'bundle-card-draft': 'write',
  'position-synthesis': 'write',
  'synthesize-target': 'write',
  'reconcile-feedback': 'write',
  'explore-local-delta': 'write',
  'position-rated-items': 'write',
  // Extract: bounded extraction, classification or summary, often in bulk.
  'material-digest': 'extract',
  'chunk-contextualize': 'extract',
  'material-classify': 'extract',
  'materials-analysis': 'extract',
  'ingestion-checkin': 'extract',
  'jd-extract': 'extract',
  'parse-profile-fields': 'extract', // was default tier (Sol); moved to mini by owner decision 2026-10-27
  'decompose-prereq-gap': 'extract',
};

// The model the old 'default' and 'heavy' tiers meant (2026-10-06 to 2026-10-27).
const LEGACY_DEFAULT_MODEL = ROLE_SETTINGS.write.model;

export interface ResolvedSetting {
  role: ModelRole | 'custom';
  model: string;
  effort: string | undefined;
}

const fromModel = (model: string): ResolvedSetting => ({ role: 'custom', model, effort: DEFAULT_REASONING_EFFORT[model] });
const fromRole = (role: ModelRole): ResolvedSetting => ({ role, model: ROLE_SETTINGS[role].model, effort: ROLE_SETTINGS[role].effort });

/**
 * Resolve a settings row (or no row: tier null) to a role, model and effort.
 * Old tier names: light → extract; default/heavy → the function's role,
 * except on an Extract function, where they keep the model they meant.
 * Unknown values fall back to the function's role.
 */
export function resolveSetting(functionId: AIFunctionId, tier: string | null, customModel: string | null): ResolvedSetting {
  const role = DEFAULT_ROLES[functionId];
  if (tier === 'custom' && customModel && customModel.trim().length > 0) return fromModel(customModel.trim());
  if ((MODEL_ROLES as readonly string[]).includes(tier ?? '')) return fromRole(tier as ModelRole);
  if (tier === 'light') return fromRole('extract');
  if ((tier === 'default' || tier === 'heavy') && role === 'extract') return fromModel(LEGACY_DEFAULT_MODEL);
  return fromRole(role);
}

export const FUNCTION_LABELS: Record<AIFunctionId, string> = {
  'capture-chat': 'Capture audit conversation',
  'capture-scores': 'Capture scoring (Generate Profile)',
  'materials-analysis': 'Materials AI analysis (per-file)',
  'explore-local-delta': 'Explore — local delta (change object + predicted KUD deltas)',
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
  'intended-skills-extract': 'Intended skills extractor',
  'parse-profile-fields': 'Parse pasted profile text into fields',
  'extract-course-kud': 'Course KUD generator (Generate KUDs)',
  'synthesize-target': 'Career-target synthesis (admin)',
  'reconcile-feedback': 'Reconcile feedback (guided faculty review)',
  'material-classify': 'Material tier classifier (deck vs reading)',
  'explore-agent': 'Explore agent (course-change thinking partner)',
  'objective-evidence-guide': 'Objective assessment guide (wiki course page)',
  'bundle-card-draft': 'Bundle card drafting',
  'bundle-map-onet': 'Bundle placement (O*NET)',
  'kud-chat': 'Course KUD chat',
};

export const FUNCTION_DESCRIPTIONS: Record<AIFunctionId, string> = {
  'capture-chat': "The auditor's per-turn replies during a capture conversation.",
  'capture-scores': 'Producing the structured Course Outcome Profile from the audit transcript.',
  'materials-analysis': 'AI analysis of an uploaded PDF / DOCX during the materials phase.',
  'explore-local-delta': 'Translating a proposed course change into a structured ChangeObject (activity, artifact, touched competencies, rubric criteria, new incoming demands) + PredictedDelta[] (before→after KUD shift per competency, with confidence and rationale).',
  'program-score-coverage': 'Scoring each captured snapshot against each career target\'s sub-competencies for the program coverage matrix.',
  'decompose-prereq-gap': 'Decomposing one free-form prereq-gap finding into a structured list of competencies with K/U/D depths, for the copy-as-KUD button in the review panel.',
  'material-digest': 'Per-material structured digest, generated at extraction for every material. Loaded into the audit agent\'s at-rest context.',
  'chunk-contextualize': 'One short positional blurb per detail chunk, prepended before embedding so the embedding encodes position + content.',
  'ingestion-checkin': 'Reviews the curated materials state before audit chat begins and emits either a short heads-up panel or silence.',
  'capture-chat-agent': 'Per-turn agent loop for CourseCapture v2 audit chat; reads at-rest digests, retrieves chunks on demand, emits a structured finding + question + citations.',
  'wiki-update': 'Regenerates the affected wiki-layer pages (course, competencies, targets, concepts) from a new snapshot + related substrate. Returns a page map; Task A3 git-ops writes + commits.',
  'curriculum-chat': 'Faculty-facing chat over the curriculum wiki. Tool-using agent reads / lists / searches wiki pages and emits a markdown response with structured page citations. Powers Explore\'s "Ask" tab and the future standalone /ask route.',
  'capture-stress-test': 'Adversarial review of a produced Course Outcome Profile: challenges per-finding confidence, surfaces internal contradictions, flags catalog-vs-evidence claims that don\'t hold up. Judge role; runs automatically once after each profile is generated (its flags drive the "Worth a look" review cards), plus on a manual Re-check.',
  'jd-extract': 'One-shot extraction of structured fields from a job description (Docling markdown or pasted text), with per-field confidence scores.',
  'position-rated-items': 'Generates 10 "experiences worth having" candidates from pages 1-4 inputs + career target sub-competencies. Single-call generator.',
  'position-interview-agent': 'Per-turn interview agent for page 6 of Position Capture; anchor-probe-confirm posture using pages 1-5 context. Emits AuditResponse-shaped output.',
  'position-synthesis': 'Synthesis over a completed page 6 interview transcript + upstream page inputs; produces a structured PositionProfile.',
  'prereq-edge-seed': 'Reads a focal course\'s free-text prerequisites + incoming-expectation statements + the catalog sub-competencies and proposes direct, skill-tagged prerequisite edges with expected K/U/D depths.',
  'intended-skills-extract': 'Reads a course\'s catalog text (description, learning objectives, major projects, skills required) + the sub-competency catalog and emits INTENDED (syllabus-asserted, NOT verified student attainment) K/U/D per sub-competency the catalog plausibly implies.',
  'parse-profile-fields': 'Parses pasted free-text profile prose into structured CaptureProfile fields (the /parse-profile route).',
  'extract-course-kud': 'Generates a course KUD result from catalog text (the Generate KUDs action / kuds/generate route).',
  'synthesize-target': 'Synthesizes a career target\'s sub-competencies + descriptors from industry/partner input (admin synthesis run).',
  'reconcile-feedback': 'Proposes per-item edits (keep/modify/remove/add with revised K/U/D and rationale) from faculty prose feedback over a capture section. Proposals only — never sets provenance; the apply step does that.',
  'material-classify': 'Classifies a file-bucket material as a lecture deck/slides (→ middle tier) or a reading/reference (→ background tier) from filename, MIME type, size, page count, and optional peek text.',
  'explore-agent': 'Tool-using course-change thinking partner anchored to one focal course. Per-turn agent loop: reads neighbor context + wiki via tools, optionally runs estimate_impact for concrete KUD sizing, emits a cited markdown response. Supports PREDICT ("what happens if I change X?") and SUGGEST ("how do I achieve goal Y?") postures with scenario save/compare tools for multi-option exploration.',
  'objective-evidence-guide': 'Writes the per-course guide on the public wiki page: each syllabus objective quoted verbatim, which Canvas assignments and rubric rows measure it, and what class-level numbers to gather at the end of the semester. Runs after each snapshot; names not found in Canvas are dropped by a deterministic check.',
  'bundle-card-draft': "Drafting each catalog bundle's card (what it includes and excludes, how it differs from neighbors, examples) for owner approval.",
  'bundle-map-onet': 'Placing O*NET elements and task statements into catalog bundles as core, related or fringe members, for review on /admin/bundles.',
  'kud-chat': "Replies in the chat about a course's KUDs (the kuds/chat route).",
};

interface CachedSetting {
  tier: string | null;
  customModel: string | null;
  fetchedAt: number;
}

// Lightweight in-process cache. Settings change rarely; we trade fresh-on-
// every-call for fresh-on-every-60-seconds and avoid hammering Postgres.
const SETTING_TTL_MS = 60_000;
const settingsCache = new Map<AIFunctionId, CachedSetting>();

/**
 * The model and reasoning effort a function runs with: its settings row
 * (a role, a custom model, or an old tier name), or its compiled-in role
 * when no row exists.
 */
export async function resolveForFunction(functionId: AIFunctionId): Promise<{ model: string; effort: string | undefined }> {
  const now = Date.now();
  let cached = settingsCache.get(functionId);
  if (!cached || now - cached.fetchedAt >= SETTING_TTL_MS) {
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
    cached = { tier: row?.tier ?? null, customModel: row?.customModel ?? null, fetchedAt: now };
    settingsCache.set(functionId, cached);
  }
  const { model, effort } = resolveSetting(functionId, cached.tier, cached.customModel);
  return { model, effort };
}

/** The model a function runs on (scripts that only need the name). */
export async function resolveModelForFunction(functionId: AIFunctionId): Promise<string> {
  return (await resolveForFunction(functionId)).model;
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
  /** The stored value as resolved: a role, or 'custom'. */
  tier: StoredTier;
  customModel: string | null;
  resolvedModel: string;
  resolvedEffort: string | undefined;
  defaultRole: ModelRole;
}

/** Read all settings rows + each function's default role + the model and
 * effort it would use right now. Used by the settings UI to populate the form. */
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
    const customModel = stored?.customModel ?? null;
    const resolved = resolveSetting(functionId, stored?.tier ?? null, customModel);
    return {
      functionId,
      tier: resolved.role,
      customModel: resolved.role === 'custom' ? customModel : null,
      resolvedModel: resolved.model,
      resolvedEffort: resolved.effort,
      defaultRole: DEFAULT_ROLES[functionId],
    };
  });
}

export interface UpsertFunctionSettingInput {
  functionId: AIFunctionId;
  tier: StoredTier;
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
