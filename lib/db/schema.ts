import { pgTable, pgEnum, pgView, check, uuid, text, jsonb, timestamp, date, integer, smallint, bigint, real, boolean, primaryKey, index, unique, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CaptureProfile, CaptureReadiness, CaptureReviewerStatus } from '@/lib/ai/capture/schema';
import type { ReconciliationLogEntry } from '@/lib/ai/schemas';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';

export const careerTargets = pgTable('career_targets', {
  id: text('id').primaryKey(),               // stable slug like 'production-operations'
  name: text('name').notNull(),
  shortDefinition: text('short_definition').notNull(),
  industryContexts: jsonb('industry_contexts').$type<string[]>().notNull(),
  knowDescriptors: jsonb('know_descriptors').$type<string[]>().notNull(),
  understandDescriptors: jsonb('understand_descriptors').$type<string[]>().notNull(),
  doDescriptors: jsonb('do_descriptors').$type<string[]>().notNull(),
  defensibilityNote: text('defensibility_note').notNull(),
  socCode: text('soc_code'),                 // nullable
  displayOrder: integer('display_order').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const subCompetencies = pgTable('sub_competencies', {
  id: text('id').primaryKey(),               // stable slug; never changes once created
  name: text('name').notNull(),
  knowDescriptor: text('know_descriptor'),            // null for foundational (D-only) rows — 0060
  understandDescriptor: text('understand_descriptor'), // null for foundational (D-only) rows — 0060
  doDescriptor: text('do_descriptor').notNull(),
  retired: boolean('retired').default(false).notNull(),  // catalog attribute; soft delete so old coverage doesn't orphan
  /**
   * P0b (migration 0057): the survivor competency this one was merged into,
   * or null for an active (unmerged) competency. CHECK requires retired=true
   * whenever this is set. The full merge history (including identity rows
   * for every unmerged competency) lives in sub_competency_map.
   */
  mergedInto: text('merged_into'),
  /**
   * P1 (migration 0058): where this catalog row came from. Defaults and
   * backfills to 'migrated' for every pre-P1 row. 'gc_authored' = drafted by
   * the controller and owner-approved (e.g. the business-acumen set, Task 5
   * — enters unlinked). 'onet_seeded' is unused until P2.
   */
  origin: text('origin').notNull().default('migrated'),
  /** 0060: D-only foundational competency (K/U descriptors null). Independent of stratum. */
  foundational: boolean('foundational').notNull().default(false),
  /** 0060: 'derived' competencies are never scored per course. */
  scoring: text('scoring', { enum: ['direct', 'derived'] }).notNull().default('direct'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: 'sub_competencies_merged_into_fk', columns: [t.mergedInto], foreignColumns: [t.id] }).onDelete('restrict'),
  check('sub_competencies_merged_into_retired_check', sql`${t.mergedInto} IS NULL OR ${t.retired}`),
  check('sub_competencies_origin_check', sql`${t.origin} IN ('migrated', 'gc_authored', 'onet_seeded')`),
  check('sub_competencies_scoring_check', sql`${t.scoring} IN ('direct', 'derived')`),
  check('sub_competencies_foundational_ku_check', sql`(${t.foundational} AND ${t.knowDescriptor} IS NULL AND ${t.understandDescriptor} IS NULL) OR (NOT ${t.foundational} AND ${t.knowDescriptor} IS NOT NULL AND ${t.understandDescriptor} IS NOT NULL)`),
]);

/**
 * Merge history (migration 0057): one row per catalog competency, ever.
 * Unmerged competencies map to themselves (identity row). A merged-away
 * competency maps to its survivor. Covers every sub_competencies row
 * (count(sub_competency_map) == count(sub_competencies) as of 0057).
 */
export const subCompetencyMap = pgTable('sub_competency_map', {
  oldSubCompetencyId: text('old_sub_competency_id').primaryKey().references(() => subCompetencies.id, { onDelete: 'restrict' }),
  competencyId: text('competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'restrict' }),
  mergeNote: text('merge_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * P1 (migration 0058): one row per (career target, horizon, SOC, O*NET code,
 * source) occupation-mix entry — see docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
 * Rulings 1-4. `source = 'alumni_rule'` rows are replaced wholesale by the
 * ingest on every run; `source = 'faculty'` rows are never touched by it.
 * Hand-written migration: `UNIQUE NULLS NOT DISTINCT` and the two
 * cross-column CHECKs below are expressed directly, matching 0058's SQL
 * exactly (Drizzle 0.45.2 DOES support `.nullsNotDistinct()`, confirmed
 * against the pg-core type defs — no SQL/schema mismatch here).
 */
export const careerTargetOccupations = pgTable('career_target_occupations', {
  id: uuid('id').primaryKey().defaultRandom(),
  careerTargetId: text('career_target_id').notNull(),
  horizon: text('horizon').notNull(),                 // 'entry' | 'growth'
  socCode: text('soc_code').notNull(),                // 'XX-XXXX'
  onetSocCode: text('onet_soc_code'),                 // 'XX-XXXX.XX', null unless onet_status = 'rated'
  onetStatus: text('onet_status').notNull(),           // 'rated' | 'unrated' | 'no_fit'
  count: integer('count').notNull(),
  share: real('share').notNull(),
  source: text('source').notNull(),                   // 'alumni_rule' | 'faculty'
  sourceVersion: text('source_version').notNull(),
  asOf: date('as_of').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_career_target_occupations_target').on(t.careerTargetId, t.horizon),
  // Every name below matches what Postgres actually assigned the unnamed
  // constraint in 0058's hand-written SQL (confirmed via `pg_constraint` on
  // the applied scratch clone — fix round 1, hostile review) rather than a
  // guessed or Drizzle-default name. A drift test
  // (tests/db/p1-constraint-names.test.ts) pins every one of these against
  // pg_constraint going forward.
  foreignKey({ name: 'career_target_occupations_career_target_id_fkey', columns: [t.careerTargetId], foreignColumns: [careerTargets.id] }).onDelete('cascade'),
  unique('career_target_occupations_career_target_id_horizon_soc_code_key')
    .on(t.careerTargetId, t.horizon, t.socCode, t.onetSocCode, t.source)
    .nullsNotDistinct(),
  check('career_target_occupations_horizon_check', sql`${t.horizon} IN ('entry', 'growth')`),
  check('career_target_occupations_soc_code_check', sql`${t.socCode} ~ '^[0-9]{2}-[0-9]{4}$'`),
  check('career_target_occupations_onet_soc_code_check', sql`${t.onetSocCode} IS NULL OR ${t.onetSocCode} ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'`),
  check('career_target_occupations_onet_status_check', sql`${t.onetStatus} IN ('rated', 'unrated', 'no_fit')`),
  check('career_target_occupations_count_check', sql`${t.count} > 0`),
  check('career_target_occupations_share_check', sql`${t.share} > 0 AND ${t.share} <= 1`),
  check('career_target_occupations_source_check', sql`${t.source} IN ('alumni_rule', 'faculty')`),
  // Fix round 1 (Important #1): was 'career_target_occupations_rated_consistency_check' —
  // Postgres names an unnamed CHECK with no column suffix it can infer
  // `<table>_check` when it can't derive a single-column name from the
  // expression; it does NOT echo a chosen name back even when the SQL gives
  // the constraint no explicit name of its own (0058's CHECK is unnamed).
  check('career_target_occupations_check', sql`(${t.onetStatus} = 'rated') = (${t.onetSocCode} IS NOT NULL)`),
]);

/**
 * P1 (migration 0058): O*NET reference store, one release at a time (31.0).
 * Scoped to only the O*NET codes that appear `rated` in
 * career_target_occupations (Ruling 5) — not the full O*NET database.
 */
export const onetRelease = pgTable('onet_release', {
  release: text('release').primaryKey(),               // e.g. '31.0'
  published: text('published').notNull(),               // e.g. 'August 2026'
  license: text('license').notNull(),                   // 'CC BY 4.0'
  attribution: text('attribution').notNull(),
  sourceUrl: text('source_url').notNull(),
  loadedAt: timestamp('loaded_at', { withTimezone: true }).defaultNow().notNull(),
});

export const onetOccupations = pgTable('onet_occupations', {
  release: text('release').notNull(),
  onetSocCode: text('onet_soc_code').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
}, (t) => [
  // Explicit names matching pg_constraint on the applied scratch (fix round 1):
  // an unnamed composite PRIMARY KEY/FOREIGN KEY built via Drizzle's
  // primaryKey()/foreignKey() helpers (no inline `.references()` — that
  // builder takes no `name` option) computes ITS OWN default suffix
  // (`_pk`/`_fk`) when left unnamed, which is NOT what Postgres assigns to
  // the equivalent unnamed SQL (`_pkey`/`_fkey`) — so leaving these unnamed
  // would itself be drift.
  primaryKey({ name: 'onet_occupations_pkey', columns: [t.release, t.onetSocCode] }),
  foreignKey({ name: 'onet_occupations_release_fkey', columns: [t.release], foreignColumns: [onetRelease.release] }).onDelete('cascade'),
]);

export const onetElementRatings = pgTable('onet_element_ratings', {
  release: text('release').notNull(),
  onetSocCode: text('onet_soc_code').notNull(),
  domain: text('domain').notNull(),                     // 'knowledge' | 'abilities' | 'work_activities' | 'essential_skills' | 'transferable_skills'
  elementId: text('element_id').notNull(),
  elementName: text('element_name').notNull(),
  scaleId: text('scale_id').notNull(),                   // 'IM' | 'LV'
  dataValue: real('data_value').notNull(),
  n: integer('n'),
  standardError: real('standard_error'),
  recommendSuppress: boolean('recommend_suppress').notNull(),
  notRelevant: boolean('not_relevant').notNull(),
  dateText: text('date_text').notNull(),
  domainSource: text('domain_source').notNull(),
}, (t) => [
  primaryKey({ name: 'onet_element_ratings_pkey', columns: [t.release, t.onetSocCode, t.domain, t.elementId, t.scaleId] }),
  // Fix round 1 (Important #1): was 'onet_element_ratings_occupation_fk'.
  foreignKey({ name: 'onet_element_ratings_release_onet_soc_code_fkey', columns: [t.release, t.onetSocCode], foreignColumns: [onetOccupations.release, onetOccupations.onetSocCode] }).onDelete('cascade'),
  check('onet_element_ratings_domain_check', sql`${t.domain} IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills')`),
  check('onet_element_ratings_scale_id_check', sql`${t.scaleId} IN ('IM', 'LV')`),
]);

export const onetTaskStatements = pgTable('onet_task_statements', {
  release: text('release').notNull(),
  onetSocCode: text('onet_soc_code').notNull(),
  taskId: text('task_id').notNull(),
  task: text('task').notNull(),
  taskType: text('task_type'),
}, (t) => [
  primaryKey({ name: 'onet_task_statements_pkey', columns: [t.release, t.onetSocCode, t.taskId] }),
  // Fix round 1 (Important #1): was 'onet_task_statements_occupation_fk'.
  foreignKey({ name: 'onet_task_statements_release_onet_soc_code_fkey', columns: [t.release, t.onetSocCode], foreignColumns: [onetOccupations.release, onetOccupations.onetSocCode] }).onDelete('cascade'),
]);

export const onetTaskRatings = pgTable('onet_task_ratings', {
  release: text('release').notNull(),
  onetSocCode: text('onet_soc_code').notNull(),
  taskId: text('task_id').notNull(),
  scaleId: text('scale_id').notNull(),                   // 'IM' | 'RT' | 'FT'
  category: text('category').notNull().default(''),      // FT stores a category; other scales use ''
  dataValue: real('data_value').notNull(),
  n: integer('n'),
  standardError: real('standard_error'),
  recommendSuppress: boolean('recommend_suppress').notNull(),
  dateText: text('date_text').notNull(),
  domainSource: text('domain_source').notNull(),
}, (t) => [
  primaryKey({ name: 'onet_task_ratings_pkey', columns: [t.release, t.onetSocCode, t.taskId, t.scaleId, t.category] }),
  // Fix round 1 (Important #1): was 'onet_task_ratings_task_fk'.
  foreignKey({ name: 'onet_task_ratings_release_onet_soc_code_task_id_fkey', columns: [t.release, t.onetSocCode, t.taskId], foreignColumns: [onetTaskStatements.release, onetTaskStatements.onetSocCode, onetTaskStatements.taskId] }).onDelete('cascade'),
  check('onet_task_ratings_scale_id_check', sql`${t.scaleId} IN ('IM', 'RT', 'FT')`),
]);

// ─── P2 (migration 0059): bundle membership ────────────────────────────────
// Every constraint name below matches 0059's hand-written SQL exactly
// (pinned by tests/db/p2-constraint-names.test.ts). bundle_members has NO
// FK to onet_* on purpose: load-onet.ts reloads a release by deleting
// onet_occupations (children cascade), which would wipe reviewed members.

export type BundleStratum = 'foundational' | 'technical' | 'business' | 'workflow_ai';
export type BundlePosition = 'core' | 'related' | 'fringe';
export type BundleMemberStatus = 'proposed' | 'confirmed' | 'rejected';
export type BundleMemberSource = 'onet_element' | 'onet_task' | 'course_skill' | 'esco_skill';

/** What the blind reviewer was shown, saved at submit (migration 0061): element ids and the task-row map (row key -> that row's group keys). */
export interface ShownItems { elementIds: string[]; taskRows: Record<string, string[]> }

export interface GoldenCandidate {
  key: string;            // taskGroupKey (Ruling 5)
  label: string;          // task text
  rank: number;           // 1-based cosine rank
  score: number;          // cosine similarity
  members: Array<{ taskId: string; onetSocCode: string }>;
}

export const bundleCards = pgTable('bundle_cards', {
  competencyId: text('competency_id').notNull(),
  stratum: text('stratum').$type<BundleStratum>().notNull(),
  includes: text('includes').notNull(),
  excludes: text('excludes').notNull(),
  distinctions: text('distinctions').notNull(),
  positiveExamples: text('positive_examples').array().notNull(),
  negativeExamples: text('negative_examples').array().notNull(),
  status: text('status').$type<'draft' | 'confirmed'>().notNull(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_cards_pkey', columns: [t.competencyId] }),
  foreignKey({ name: 'bundle_cards_competency_id_fkey', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_cards_stratum_check', sql`${t.stratum} IN ('foundational', 'technical', 'business', 'workflow_ai')`),
  check('bundle_cards_status_check', sql`${t.status} IN ('draft', 'confirmed')`),
  check('bundle_cards_confirmed_check', sql`(${t.status} = 'confirmed') = (${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`),
]);

export const itemEmbeddings = pgTable('item_embeddings', {
  kind: text('kind').$type<'bundle_card' | 'onet_task' | 'onet_element' | 'course_skill' | 'esco_skill'>().notNull(),
  ref: text('ref').notNull(),
  model: text('model').notNull(),
  textHash: text('text_hash').notNull(),
  vector: real('vector').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'item_embeddings_pkey', columns: [t.kind, t.ref, t.model, t.textHash] }),
  check('item_embeddings_kind_check', sql`${t.kind} IN ('bundle_card', 'onet_task', 'onet_element', 'course_skill', 'esco_skill')`),
  check('item_embeddings_vector_check', sql`cardinality(${t.vector}) > 0`),
]);

export const onetElementDefinitions = pgTable('onet_element_definitions', {
  release: text('release').notNull(),
  domain: text('domain').notNull(),
  elementId: text('element_id').notNull(),
  elementName: text('element_name').notNull(),
  description: text('description').notNull(),
}, (t) => [
  primaryKey({ name: 'onet_element_definitions_pkey', columns: [t.release, t.elementId] }),
  foreignKey({ name: 'onet_element_definitions_release_fkey', columns: [t.release], foreignColumns: [onetRelease.release] }).onDelete('cascade'),
  check('onet_element_definitions_domain_check', sql`${t.domain} IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills')`),
]);

export const bundleMappingRuns = pgTable('bundle_mapping_runs', {
  id: uuid('id').defaultRandom().notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  taskShortlistK: integer('task_shortlist_k').notNull(),
  bundleCount: integer('bundle_count').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull().default(0),
  dryRun: boolean('dry_run').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'bundle_mapping_runs_pkey', columns: [t.id] }),
  check('bundle_mapping_runs_k_check', sql`${t.taskShortlistK} > 0`),
  check('bundle_mapping_runs_cost_check', sql`${t.costUsdCents} >= 0`),
]);

export const bundleMembers = pgTable('bundle_members', {
  id: uuid('id').defaultRandom().notNull(),
  bundleId: text('bundle_id').notNull(),
  source: text('source').$type<BundleMemberSource>().notNull(),
  externalId: text('external_id').notNull(),
  externalLabel: text('external_label').notNull(),
  onetSocCode: text('onet_soc_code'),
  release: text('release'),
  position: text('position').$type<BundlePosition>().notNull(),
  aiPosition: text('ai_position').$type<BundlePosition>(),
  status: text('status').$type<BundleMemberStatus>().notNull(),
  proposedBy: text('proposed_by').notNull(),
  rationale: text('rationale'),
  runId: uuid('run_id'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  bulkConfirmed: boolean('bulk_confirmed').notNull().default(false),
  reviewNote: text('review_note'),
  centroidDistance: real('centroid_distance'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_members_pkey', columns: [t.id] }),
  foreignKey({ name: 'bundle_members_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  foreignKey({ name: 'bundle_members_run_id_fkey', columns: [t.runId], foreignColumns: [bundleMappingRuns.id] }).onDelete('set null'),
  check('bundle_members_source_check', sql`${t.source} IN ('onet_element', 'onet_task', 'course_skill', 'esco_skill')`),
  check('bundle_members_position_check', sql`${t.position} IN ('core', 'related', 'fringe')`),
  check('bundle_members_ai_position_check', sql`${t.aiPosition} IS NULL OR ${t.aiPosition} IN ('core', 'related', 'fringe')`),
  check('bundle_members_status_check', sql`${t.status} IN ('proposed', 'confirmed', 'rejected')`),
  check('bundle_members_soc_check', sql`(${t.source} = 'onet_task') = (${t.onetSocCode} IS NOT NULL)`),
  check('bundle_members_release_check', sql`(${t.source} IN ('onet_element', 'onet_task')) = (${t.release} IS NOT NULL)`),
  check('bundle_members_decision_check', sql`(${t.status} = 'proposed') = (${t.confirmedBy} IS NULL AND ${t.confirmedAt} IS NULL)`),
  check('bundle_members_reviewer_added_check', sql`${t.proposedBy} <> 'reviewer' OR (${t.aiPosition} IS NULL AND ${t.status} <> 'proposed')`),
  unique('bundle_members_item_key').on(t.bundleId, t.source, t.release, t.externalId, t.onetSocCode).nullsNotDistinct(),
  index('idx_bundle_members_bundle_status').on(t.bundleId, t.status),
]);

export const bundleMappingOutcomes = pgTable('bundle_mapping_outcomes', {
  runId: uuid('run_id').notNull(),
  bundleId: text('bundle_id').notNull(),
  status: text('status').$type<'ok' | 'failed'>().notNull(),
  noCleanMatch: boolean('no_clean_match').notNull(),
  note: text('note'),
  costUsdCents: integer('cost_usd_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_mapping_outcomes_pkey', columns: [t.runId, t.bundleId] }),
  foreignKey({ name: 'bundle_mapping_outcomes_run_id_fkey', columns: [t.runId], foreignColumns: [bundleMappingRuns.id] }).onDelete('cascade'),
  foreignKey({ name: 'bundle_mapping_outcomes_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_mapping_outcomes_status_check', sql`${t.status} IN ('ok', 'failed')`),
  check('bundle_mapping_outcomes_failed_check', sql`${t.status} = 'ok' OR ${t.noCleanMatch} = false`),
]);

export const bundleGoldenSamples = pgTable('bundle_golden_samples', {
  bundleId: text('bundle_id').notNull(),
  stratum: text('stratum').$type<BundleStratum>().notNull(),
  sampleSeed: text('sample_seed').notNull(),
  candidates: jsonb('candidates').$type<GoldenCandidate[]>().notNull(),
  reviewer: text('reviewer'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  resetNote: text('reset_note'),
  shownItems: jsonb('shown_items').$type<ShownItems>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_golden_samples_pkey', columns: [t.bundleId] }),
  foreignKey({ name: 'bundle_golden_samples_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [subCompetencies.id] }).onDelete('restrict'),
  check('bundle_golden_samples_stratum_check', sql`${t.stratum} IN ('foundational', 'technical', 'business', 'workflow_ai')`),
  check('bundle_golden_samples_submitted_check', sql`${t.submittedAt} IS NULL OR ${t.reviewer} IS NOT NULL`),
]);

export const bundleGoldenPicks = pgTable('bundle_golden_picks', {
  id: uuid('id').defaultRandom().notNull(),
  bundleId: text('bundle_id').notNull(),
  reviewer: text('reviewer').notNull(),
  source: text('source').$type<'onet_element' | 'onet_task'>(),
  externalId: text('external_id'),
  onetSocCode: text('onet_soc_code'),
  release: text('release'),
  position: text('position').$type<BundlePosition>(),
  noCleanMatch: boolean('no_clean_match').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'bundle_golden_picks_pkey', columns: [t.id] }),
  foreignKey({ name: 'bundle_golden_picks_bundle_id_fkey', columns: [t.bundleId], foreignColumns: [bundleGoldenSamples.bundleId] }).onDelete('cascade'),
  check('bundle_golden_picks_source_check', sql`${t.source} IS NULL OR ${t.source} IN ('onet_element', 'onet_task')`),
  check('bundle_golden_picks_position_check', sql`${t.position} IS NULL OR ${t.position} IN ('core', 'related', 'fringe')`),
  check('bundle_golden_picks_shape_check', sql`(${t.noCleanMatch} AND ${t.source} IS NULL AND ${t.externalId} IS NULL AND ${t.position} IS NULL AND ${t.onetSocCode} IS NULL AND ${t.release} IS NULL) OR (NOT ${t.noCleanMatch} AND ${t.source} IS NOT NULL AND ${t.externalId} IS NOT NULL AND ${t.position} IS NOT NULL AND ${t.release} IS NOT NULL AND (${t.source} = 'onet_task') = (${t.onetSocCode} IS NOT NULL))`),
  unique('bundle_golden_picks_item_key').on(t.bundleId, t.reviewer, t.source, t.externalId, t.onetSocCode).nullsNotDistinct(),
]);

export const prototypeTargetEdits = pgTable('prototype_target_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),
  entityType: text('entity_type').notNull(),     // 'career_target' | 'sub_competency'
  entityId: text('entity_id').notNull(),
  changeType: text('change_type').notNull(),     // 'create' | 'update' | 'retire' | 'reorder'
  before: jsonb('before'),                       // null on create
  after: jsonb('after'),                         // null on retire/delete
});

export const prototypeRuns = pgTable('prototype_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),                 // SHA-256(ip) — never store raw IP
  careerTargetId: text('career_target_id').notNull(),
  courseLabel: text('course_label'),                 // label of the course being analyzed
  courseSyllabus: text('course_syllabus').notNull(), // syllabus of the course being analyzed
  priorCoursework: jsonb('prior_coursework').$type<Array<{ courseLabel: string; syllabus: string }>>().notNull(), // all prior courses
  result: jsonb('result').notNull(),                 // the full AnalysisResult object
  aiProvider: text('ai_provider').notNull(),
  aiModel: text('ai_model').notNull(),
  costUsdCents: bigint('cost_usd_cents', { mode: 'number' }).notNull(), // estimated cost in 1/100 of a cent
  durationMs: integer('duration_ms').notNull(),
  analysisKind: text('analysis_kind').notNull().default('course_prereqs'),
});

export const prototypeFlags = pgTable('prototype_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  runId: uuid('run_id').notNull().references(() => prototypeRuns.id, { onDelete: 'cascade' }),
  flagType: text('flag_type').notNull(),             // 'coverage' | 'prerequisite_gap' | 'kud_draft' | 'target_chain_coverage' | 'target_chain_scaffolding'
  target: text('target').notNull(),                  // e.g., "course.sub_comp_id", "prior-0.sub_comp_id", or "gap.id"
  note: text('note').notNull(),
  resolved: boolean('resolved').default(false).notNull(),
});

export const dailyCost = pgTable('daily_cost', {
  day: text('day').primaryKey(),               // 'YYYY-MM-DD' UTC
  totalCostUsdCents: bigint('total_cost_usd_cents', { mode: 'number' }).notNull().default(0),
  lastAlertSent: timestamp('last_alert_sent', { withTimezone: true }),
});

export const ipHourly = pgTable('ip_hourly', {
  ipHash: text('ip_hash').notNull(),
  hourKey: text('hour_key').notNull(),         // 'YYYY-MM-DDTHH' UTC
  count: integer('count').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.ipHash, t.hourKey] }),
}));

export const courseCategory = pgEnum('course_category', ['gc_core', 'specialty', 'major_req', 'other']);
export const courseCodeRole = pgEnum('course_code_role', ['lecture', 'lab', 'other']);
export const courseScope = pgEnum('course_scope', ['gc', 'external']);
export const courseStatus = pgEnum('course_status', ['offered', 'proposed', 'sandbox', 'retired']);

export const courses = pgTable('courses', {
  code: text('code').primaryKey(),                                // 'GC 3460', 'GC 4900ap'
  title: text('title').notNull(),
  level: integer('level').notNull(),                              // 1-4
  track: text('track').notNull(),
  description: text('description').notNull().default(''),
  prerequisites: text('prerequisites').notNull().default(''),
  syllabusUrl: text('syllabus_url'),                              // nullable
  learningObjectives: jsonb('learning_objectives').$type<string[]>().notNull().default([]),
  majorProjects: jsonb('major_projects').$type<string[]>().notNull().default([]),
  skillsRequired: jsonb('skills_required').$type<string[]>().notNull().default([]),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
  builderStatus: text('builder_status').notNull().default('draft'),
  auditMode: text('audit_mode').notNull().default('full'),  // 'full' | 'simple'
  category: courseCategory('category').notNull().default('other'),
  buildsToCareer: boolean('builds_to_career').notNull().default(false),
  // Scope & lifecycle (2026-06-15). `scope` = owning curriculum ('gc' today;
  // 'external' = sandbox/another-uni). `status` = lifecycle. The pair drives
  // isProgramVisible — see lib/courses/program-visibility.ts (added in a later task).
  scope: courseScope('scope').notNull().default('gc'),
  status: courseStatus('status').notNull().default('offered'),
  catalogUrl: text('catalog_url'),                                // nullable — Clemson catalog link
  // Structured identity (migration 0037). `code` stays the canonical PK;
  // these are the parsed parts — see lib/courses/parse-course-code.ts.
  prefix: text('prefix').notNull().default(''),
  courseNumber: integer('course_number'),                 // nullable; null only for an unparseable code
  numberSuffix: text('number_suffix').notNull().default(''),
  // Set by the canvas-import route on each successful import; provenance display
  // on the capture Step-1 Canvas box header.
  canvasCourseName: text('canvas_course_name'),                   // nullable — e.g. "S2405-GC-3800 Junior Seminar"
  canvasImportedAt: timestamp('canvas_imported_at', { withTimezone: true }), // nullable
});

/**
 * Paired (secondary) course codes bundled under a primary course — e.g. a lab
 * (GC 3461) bundled under its lecture (GC 3460). The paired code is NOT a
 * `courses` row; it has no independent capture/snapshot/tenant. A primary
 * course with >=1 row here is a "bundle". Migration 0037.
 * Spec: docs/superpowers/specs/2026-06-13-structured-course-identity-and-bundling-design.md
 */
export const courseCodes = pgTable('course_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  pairedCode: text('paired_code').notNull(),
  role: courseCodeRole('role').notNull(),
  canvasCourseName: text('canvas_course_name'),
  canvasImportedAt: timestamp('canvas_imported_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pairedUniq: unique('uq_course_codes_paired').on(t.pairedCode),
  primaryIdx: index('idx_course_codes_course').on(t.courseCode),
}));

export const sheetSyncState = pgTable('sheet_sync_state', {
  // Singleton row keyed by 'courses' — tracks the most recent successful resync.
  // Lets the admin UI render "Last synced: 3h ago" without scanning courses.
  key: text('key').primaryKey(),                                  // always 'courses' for now
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  lastSyncedCount: integer('last_synced_count').notNull(),
  lastErrors: jsonb('last_errors').$type<string[]>().notNull().default([]),
});

export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  company: text('company').notNull(),
  roleTitle: text('role_title'),
  weight: integer('weight').notNull().default(1),
  careerTargetHints: jsonb('career_target_hints').$type<string[]>().notNull().default([]),
  magicToken: text('magic_token').notNull().unique(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

/**
 * Per-person, per-course access links (spec 2026-09-30). `token_hash` is
 * sha256(token); the token itself is shown once by `pnpm access:grant` and
 * never stored. `scope` holds roster course codes or the single value '*'.
 */
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  // Faculty access panel (2026-10-07, migration 0054). Nullable: existing
  // CLI-minted grants (scripts/access/grant.ts) have no email.
  email: text('email'),
  scope: jsonb('scope').$type<string[]>().notNull().default([]),
  can: jsonb('can').$type<('capture' | 'create' | 'admin')[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

export const partnerSessions = pgTable('partner_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const sandboxGrants = pgTable('sandbox_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  // Generic invite: a grant is course-LESS at mint time. The tester defines
  // their course at the link, which CREATES a sandbox course (lib/sandbox).
  // Nullable + no FK so a grant can pre-exist any course.
  courseCode: text('course_code'),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const sandboxSessions = pgTable('sandbox_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id').notNull().references(() => sandboxGrants.id, { onDelete: 'cascade' }),
  courseCode: text('course_code').notNull(),
  instructorName: text('instructor_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const partnerEvents = pgTable('partner_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const partnerSubmissions = pgTable('partner_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').references(() => careerTargets.id),
  unmappedTargetLabel: text('unmapped_target_label'),
  positionTitle: text('position_title').notNull(),
  responsibilities: text('responsibilities').notNull().default(''),
  salaryRangeLow: integer('salary_range_low'),
  salaryRangeHigh: integer('salary_range_high'),
  salaryCurrency: text('salary_currency').notNull().default('USD'),
  interviewQuestions: jsonb('interview_questions').$type<string[]>().notNull().default([]),
  requiredSkills: jsonb('required_skills').$type<string[]>().notNull().default([]),
  niceToHaveSkills: jsonb('nice_to_have_skills').$type<string[]>().notNull().default([]),
  additionalNotes: text('additional_notes').notNull().default(''),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});

export const synthesisRuns = pgTable('synthesis_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  submissionCount: integer('submission_count').notNull(),
  result: jsonb('result').notNull(),
  model: text('model').notNull(),
  costUsdCents: bigint('cost_usd_cents', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseMaterials = pgTable('course_materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  blobUrl: text('blob_url').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  pageCount: integer('page_count'),
  extractionMethod: text('extraction_method'),      // 'text' | 'vision' | null
  extractionStatus: text('extraction_status').notNull().default('pending'), // 'pending' | 'ok' | 'low_text' | 'failed'
  extractedText: text('extracted_text'),
  // Privacy scrub (spec 2026-10-05, migration 0052): placeholder counts in the
  // stored extracted_text, or why the scrub failed (then no text is stored).
  // null = row written before the scrub existed. Shape = MaterialRedactions
  // in lib/privacy/types.ts (typed inline to keep this file's imports stable).
  redactions: jsonb('redactions').$type<{ counts: Record<string, number>; failedReason: string | null }>(),
  analysisFinding: jsonb('analysis_finding').$type<{
    materialType: string;
    competencies: Array<{ name: string; description: string; evidenceQuotes: string[] }>;
    skills: string[];
    notes: string;
  }>(),
  analysisModel: text('analysis_model'),
  analysisCostUsdCents: bigint('analysis_cost_usd_cents', { mode: 'number' }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),
  digest: text('digest'),
  digestModel: text('digest_model'),
  digestGeneratedAt: timestamp('digest_generated_at', { withTimezone: true }),
  // When true and `digest` is non-null, AI-facing context loaders use the
  // digest in place of extractedText. Default false; `updateMaterialDigest`
  // flips it to true the first time a digest is written, so newly-extracted
  // long materials auto-substitute. Faculty toggle per-row from the UI.
  useDigest: boolean('use_digest').notNull().default(false),
  // FERPA risk band derived during ingestion: 'low' | 'medium' | 'high'.
  ferpaRisk: text('ferpa_risk').notNull().default('low'),
  // Set true by policy when the material was auto-excluded from AI context
  // (e.g. high FERPA risk). When faculty overrides, `ignored` flips back to
  // false but `autoSetAside` stays true to preserve the audit trail.
  autoSetAside: boolean('auto_set_aside').notNull().default(false),
  // Human-readable reason for the auto set-aside (e.g. "PII detected").
  setAsideReason: text('set_aside_reason'),
  // Optional faculty note captured at the pre-interview gate explaining a flagged
  // material (why a gap is acceptable / will be fixed / ok to include). Increment 1
  // persists + displays it; scoring integration is a later increment.
  facultyNote: text('faculty_note'),
  // Indexing pipeline status: 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped'.
  // 'queued' = enqueued for the background ingest worker; 'pending' = inserted but not yet enqueued.
  indexingStatus: text('indexing_status').notNull().default('pending'),
  // Ingestion depth tier assigned at discovery: 'high' (full pipeline) |
  // 'middle' (per-unit summary) | 'background' (one digest). Null until the
  // tiered-ingestion classifier runs. Faculty-overridable on the triage screen.
  tier: text('tier'),  // 'high' | 'middle' | 'background' | null
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  // Set true to keep the material in the system but exclude it from AI context
  // (CourseCapture chat + scoring) — useful for Canvas imports that turn out
  // to be duplicate, outdated, or irrelevant.
  ignored: boolean('ignored').notNull().default(false),
  // Curriculum-currency state, distinct from `ignored` (which means "don't send
  // to AI": FERPA/policy/noise). `retired_at` = "the course no longer does this";
  // the cross-course spine excludes retired materials. Null = active.
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  // Per-item ignore for Canvas-list materials (Assignments, Discussions,
  // Quizzes, Pages, Module List). Array of item titles (the `## Title` text
  // that delimits each item in the concatenated extractedText). Audit
  // context + v2 chunker filter these out before sending to the AI.
  // Empty array means "all items included." Ignored at the whole-material
  // level still wins — if `ignored` is true the whole material is excluded
  // regardless of this field.
  ignoredItems: jsonb('ignored_items').$type<string[]>().notNull().default([]),
  // The code this material was imported under (a bundle's primary or a paired
  // code). null ⇒ the primary course. Provenance only — courseCode stays the
  // primary so the tenant/retrieval/FK model is unchanged. Migration 0037.
  sourceCode: text('source_code'),
  // Set true after the raw blob file is deleted on snapshot approval to reclaim
  // disk. The durable record (extractedText, digest, vectors) is unaffected.
  // Gated behind isTriageEnabled(). Migration 0043.
  rawCleared: boolean('raw_cleared').notNull().default(false),
  // Per-run ingest mode, set when the Triage "Ingest & continue" enqueues a row.
  // null = hybrid (default: OpenAI image-PDF transcription, campus text w/ OpenAI
  // fallback). 'local' = local-only run (omlx transcription, campus text w/ the
  // OpenAI fallback suppressed). Persisted so a worker restart keeps the mode.
  // Migration 0045.
  ingestProvider: text('ingest_provider'),
  // True when this material is the course syllabus — the sole source of the
  // objectives quoted by the objective assessment guide (spec 2026-10-05).
  // Set by the Canvas import for `Canvas: Syllabus`, by uploads through the
  // Syllabus box (role=syllabus), and once by migration 0051's backfill.
  isSyllabus: boolean('is_syllabus').notNull().default(false),
});

export const courseProfiles = pgTable('course_profiles', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  learningObjectives: jsonb('learning_objectives').$type<string[]>().notNull().default([]),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  competencies: jsonb('competencies').$type<Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>>().notNull().default([]),
  catalogDivergence: jsonb('catalog_divergence').$type<{
    reinforced: string[];
    additions: string[];
    gaps: string[];
  }>().notNull().default({ reinforced: [], additions: [], gaps: [] }),
  sourceRunId: uuid('source_run_id').references(() => courseProfileRuns.id, { onDelete: 'set null' }),
  manuallyEdited: boolean('manually_edited').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseProfileRuns = pgTable('course_profile_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  result: jsonb('result').$type<{
    summary: string;
    learningObjectives: string[];
    skills: string[];
    competencies: Array<{
      name: string;
      description: string;
      level: string;
      evidence: Array<{ fileName: string; quote: string }>;
    }>;
    catalogDivergence: { reinforced: string[]; additions: string[]; gaps: string[] };
  }>().notNull(),
  materialCount: integer('material_count').notNull(),
  model: text('model').notNull(),
  costUsdCents: bigint('cost_usd_cents', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseKudRuns = pgTable('course_kud_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  result: jsonb('result').$type<{
    thresholdConcept: string;
    know: string[];
    understand: string[];
    do: string[];
    confidenceNotes: string;
  }>().notNull(),
  profileSnapshot: jsonb('profile_snapshot').$type<{
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  }>().notNull(),
  model: text('model').notNull(),
  costUsdCents: bigint('cost_usd_cents', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseKuds = pgTable('course_kuds', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  thresholdConcept: text('threshold_concept').notNull(),
  know: jsonb('know').$type<string[]>().notNull().default([]),
  understand: jsonb('understand').$type<string[]>().notNull().default([]),
  do: jsonb('do').$type<string[]>().notNull().default([]),
  manuallyEdited: boolean('manually_edited').notNull().default(false),
  sourceRunId: uuid('source_run_id').references(() => courseKudRuns.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByIpHash: text('approved_by_ip_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// CourseCapture — self-contained Course Outcome Profile per course.
// One row per course (PK is course_code). The full profile is stored as
// JSONB so the alpha shape can evolve without per-field migrations; if a
// field becomes a hot query target it can be lifted into a column later.
//
// scale_version is metadata that lets future depth-scale changes (v2, v3) be
// applied without silently rewriting historical scores. For now only 'v1'.
export const courseCaptureProfiles = pgTable('course_capture_profiles', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  profile: jsonb('profile').$type<CaptureProfile>().notNull(),
  reviewerStatus: text('reviewer_status').$type<CaptureReviewerStatus>().notNull().default('ai_drafted'),
  reviewerNote: text('reviewer_note'),
  sourceSnapshotId: text('source_snapshot_id'), // nullable — the snapshot a draft was forked from (load/adopt); cleared on fresh re-score
  scaleVersion: text('scale_version').notNull().default('v1'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Immutable versioned snapshots of confirmed Course Outcome Profiles.
// Many rows per course; never hard-deleted (retired_at is the soft-delete).
// Each snapshot freezes the full profile + the context that produced it
// (inputs_meta) + the audit conversation transcript at that moment.
//
// The working draft lives in course_capture_profiles and stays mutable.
// course_capture_snapshots is the historical record that downstream
// consumers (Explore, accreditation, longitudinal analysis) read from.
export const courseCaptureSnapshots = pgTable('course_capture_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  profile: jsonb('profile').$type<CaptureProfile>().notNull(),
  inputsMeta: jsonb('inputs_meta').$type<{
    catalog: {
      description: string;
      prerequisites: string;
      learningObjectives: string[];
      majorProjects: string[];
      skillsRequired: string[];
    };
    builderProfilePresent: boolean;
    materials: Array<{
      id: string;
      fileName: string;
      extractionStatus: string;
      sizeBytes: number;
      ignored: boolean;
    }>;
    prereqSnapshotsUsed: Array<{
      courseCode: string;
      snapshotId: string;
      caption: string | null;
    }>;
    scanPasses: {
      canvasImportedAt: string | null;
      googleDocsScannedAt: string | null;
    };
  }>().notNull(),
  transcript: jsonb('transcript').$type<Array<{ role: 'user' | 'assistant'; content: string }>>().notNull().default([]),
  caption: text('caption'),
  captionNote: text('caption_note'),
  // Departmental-context narrative copied from the draft profile's
  // reviewer_note at snapshot-creation time. Frozen with the snapshot
  // so the "why" behind overrides survives in the immutable record.
  // Substrate for the future curriculum-wiki layer.
  reviewerNote: text('reviewer_note'),
  reconciliationLog: jsonb('reconciliation_log').$type<ReconciliationLogEntry[]>(),
  transcriptSessionId: uuid('transcript_session_id'),  // nullable; populated for snapshots produced by v2 captures
  scaleVersion: text('scale_version').notNull(),
  model: text('model').notNull(),
  // Whose perspective this capture represents — same course code can be
  // taught very differently by different faculty, and the depth-scoring
  // is a function of what students under that specific instructor
  // actually do. Nullable for pre-2026-06-03 snapshots (backfilled to
  // 'Department canonical' in migration 0027).
  instructorName: text('instructor_name'),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Objective assessment guide (spec 2026-10-05): one row per course, the latest
// guide only — overwritten on regeneration; history lives in the snapshots it
// is built from. Migration 0051 (hand-written).
export const courseObjectiveGuides = pgTable('course_objective_guides', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').notNull().references(() => courseCaptureSnapshots.id, { onDelete: 'cascade' }),
  guide: jsonb('guide').$type<ObjectiveGuide>().notNull(),
  droppedNames: jsonb('dropped_names').$type<string[]>().notNull().default([]),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Competency catalog P0a (spec 2026-10-11 §3, §8): which career targets use
 * each catalog competency (sub_competencies is the catalog). One row per
 * (target, competency, horizon, weight_source) so horizons stay separate and
 * sources can disagree visibly. Seeded by migration 0056 with one
 * entry / faculty / draft row per (target, sub-competency), weight NULL.
 * display_order = the competency's position within the target (every row of a
 * (target, competency) pair carries the same value). Migration 0056 (hand-written).
 */
export const careerTargetRequirements = pgTable('career_target_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  careerTargetId: text('career_target_id').notNull(),
  competencyId: text('competency_id').notNull(),
  horizon: text('horizon').$type<'entry' | 'growth'>().notNull(),
  weight: real('weight'),
  weightSource: text('weight_source').$type<'onet' | 'employer' | 'faculty'>().notNull(),
  requiredK: integer('required_k'),
  requiredU: integer('required_u'),
  requiredD: integer('required_d'),
  depthSource: text('depth_source').$type<'onet' | 'employer' | 'faculty'>(),
  status: text('status').$type<'draft' | 'confirmed'>().notNull().default('draft'),
  note: text('note'),
  contributingPositionIds: jsonb('contributing_position_ids').$type<string[]>().notNull().default([]),
  displayOrder: integer('display_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: 'career_target_requirements_target_fk', columns: [t.careerTargetId], foreignColumns: [careerTargets.id] }).onDelete('cascade'),
  foreignKey({ name: 'career_target_requirements_competency_fk', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('cascade'),
  unique('career_target_requirements_unique').on(t.careerTargetId, t.competencyId, t.horizon, t.weightSource),
  index('idx_career_target_requirements_competency').on(t.competencyId),
  check('career_target_requirements_horizon_check', sql`${t.horizon} IN ('entry', 'growth')`),
  check('career_target_requirements_weight_check', sql`${t.weight} IS NULL OR (${t.weight} >= 0 AND ${t.weight} <= 1)`),
  check('career_target_requirements_weight_source_check', sql`${t.weightSource} IN ('onet', 'employer', 'faculty')`),
  check('career_target_requirements_depth_source_check', sql`${t.depthSource} IS NULL OR ${t.depthSource} IN ('onet', 'employer', 'faculty')`),
  check('career_target_requirements_depth_check', sql`(${t.requiredK} IS NULL OR ${t.requiredK} BETWEEN 0 AND 5) AND (${t.requiredU} IS NULL OR ${t.requiredU} BETWEEN 0 AND 5) AND (${t.requiredD} IS NULL OR ${t.requiredD} BETWEEN 0 AND 5)`),
  check('career_target_requirements_status_check', sql`${t.status} IN ('draft', 'confirmed')`),
]);

/**
 * A course snapshot's evidenced K/U/D depth on one catalog competency
 * (replaces snapshot_target_coverage; spec §3). Scoring is still per target
 * with target context in P0a — only the storage key changed. Re-scoring
 * upserts on (snapshot, competency). Migration 0056 copied every old row.
 */
export const snapshotCompetencyCoverage = pgTable('snapshot_competency_coverage', {
  snapshotId: uuid('snapshot_id').notNull(),
  competencyId: text('competency_id').notNull(),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth').notNull(),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'snapshot_competency_coverage_pk', columns: [t.snapshotId, t.competencyId] }),
  foreignKey({ name: 'snapshot_competency_coverage_snapshot_fk', columns: [t.snapshotId], foreignColumns: [courseCaptureSnapshots.id] }).onDelete('cascade'),
  foreignKey({ name: 'snapshot_competency_coverage_competency_fk', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('cascade'),
  index('idx_snapshot_competency_coverage_competency').on(t.competencyId),
]);

/**
 * Migration 0057 snapshot (CREATE TABLE AS SELECT, no constraints carried
 * over — every column is nullable regardless of the source's nullability):
 * each merge survivor's own snapshot_competency_coverage cells AS THEY WERE
 * immediately before the merge carry overwrote them. Used by the
 * disagreement-flag logic (0057 step 4) and by the verify script to confirm
 * no non-retired snapshot lost a survivor cell. Read-only after the
 * migration; nothing in the app writes it.
 */
export const p0bPremergeSurvivorCoverage = pgTable('p0b_premerge_survivor_coverage', {
  snapshotId: uuid('snapshot_id'),
  competencyId: text('competency_id'),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth'),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence'),
  rationale: text('rationale'),
  model: text('model'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
});

/**
 * VIEW (migration 0056): a target's competencies in the old sub_competencies
 * row shape — membership and display_order from career_target_requirements,
 * name / descriptors / retired from the catalog. One row per (target,
 * competency). Read target membership here, never from sub_competencies.
 */
export const targetSubCompetencies = pgView('target_sub_competencies', {
  careerTargetId: text('career_target_id').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  knowDescriptor: text('know_descriptor'),            // null for foundational (D-only) rows — 0060
  understandDescriptor: text('understand_descriptor'), // null for foundational (D-only) rows — 0060
  doDescriptor: text('do_descriptor').notNull(),
  displayOrder: integer('display_order').notNull(),
  retired: boolean('retired').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();

/**
 * VIEW (migration 0056): per-target coverage cells in the old
 * snapshot_target_coverage row shape — each snapshot_competency_coverage row
 * once per target that uses the competency. Read-only; write
 * snapshotCompetencyCoverage.
 */
export const targetCoverage = pgView('target_coverage', {
  snapshotId: uuid('snapshot_id').notNull(),
  careerTargetId: text('career_target_id').notNull(),
  subCompetencyId: text('sub_competency_id').notNull(),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth').notNull(),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
}).existing();

// Per-function AI model settings. One row per function ID. Each row carries
// either a tier name ('light' | 'default' | 'heavy') that resolves to a
// model via the tier-mapping in lib/ai/function-settings.ts, or a custom
// model override that bypasses the tier mapping.
// When no row exists for a function ID, the system falls back to the
// function's compiled-in default tier.
export const aiFunctionSettings = pgTable('ai_function_settings', {
  functionId: text('function_id').primaryKey(),
  tier: text('tier').notNull(),              // 'light' | 'default' | 'heavy' | 'custom'
  customModel: text('custom_model'),          // populated when tier === 'custom'
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// In-flight CourseCapture audit conversation, persisted so faculty can
// resume after a closed tab, a failed Generate, or a next-day return.
// One row per course (PK course_code). Cleared on profile confirmation
// or by an explicit "Clear conversation" action.
export const captureConversations = pgTable('capture_conversations', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  messages: jsonb('messages').$type<Array<{ role: 'user' | 'assistant'; content: string }>>().notNull().default([]),
  readiness: jsonb('readiness').$type<CaptureReadiness | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// CourseCapture v2 — append-only conversation log keyed by session. Replaces
// the session-overwriting behavior of capture_conversations. A session_id
// groups all messages from one audit attempt; multiple sessions per course
// are allowed. Snapshots link to the session that produced them via
// course_capture_snapshots.transcript_session_id.
export const captureMessages = pgTable('capture_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  turnIndex: integer('turn_index').notNull(),
  role: text('role').notNull(),  // 'system' | 'user' | 'assistant' | 'tool'
  content: text('content'),  // nullable: assistant messages with only tool_calls and no text body
  toolCalls: jsonb('tool_calls').$type<Array<{
    id: string;
    toolName: string;
    args: Record<string, unknown>;
  }>>(),
  toolResult: jsonb('tool_result').$type<Array<{
    toolCallId: string;
    result: unknown;
  }>>(),
  citations: jsonb('citations').$type<Array<{
    type: 'chunk' | 'instructor';
    chunkId?: string;
    messageId?: string;
    excerpt: string;
  }>>(),
  // Auditor identity for this session. Frozen at session start; carried
  // through every turn so resumed sessions preserve the auditor and
  // snapshots created from this session inherit instructor_name.
  instructorName: text('instructor_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index('idx_capture_messages_session').on(table.courseCode, table.sessionId, table.turnIndex),
  sessionTurnUnique: unique('uq_capture_messages_session_turn').on(table.sessionId, table.turnIndex),
}));

/**
 * Position Capture append-only message log. One session = one Page 6
 * interview about one specific position the partner is hiring for.
 * Renamed from career_capture_messages (CareerCapture v1 retired 2026-06-04).
 */
export const positionCaptureMessages = pgTable('position_capture_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  positionCaptureId: uuid('position_capture_id').notNull().references(() => positionCaptures.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  turnIndex: integer('turn_index').notNull(),
  role: text('role').notNull(),
  content: text('content'),
  citations: jsonb('citations').$type<Array<{
    type: 'transcript' | 'page-input';
    messageId?: string;
    pageRef?: string;
    excerpt: string;
  }>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index('idx_position_capture_messages_session').on(table.positionCaptureId, table.sessionId, table.turnIndex),
  sessionTurnUnique: unique('uq_position_capture_messages_session_turn').on(table.sessionId, table.turnIndex),
}));

/**
 * Position Capture row. Drafts live here (status='draft', rolling JSONB inputs).
 * On submission becomes immutable (status='submitted'); subsequent re-captures
 * of the same position create a new row with `supersedes` pointing to the old.
 *
 * Schema 0029. Renamed from career_captures (CareerCapture v1 retired
 * 2026-06-04, subsumed by Position Capture v1).
 */
export const positionCaptures = pgTable('position_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),                          // 'draft' | 'submitted'
  company: text('company').notNull(),
  positionTitle: text('position_title'),                                       // null until partner enters one
  structuredInputs: jsonb('structured_inputs'),                                // pages 1-4 data
  ratedSkills: jsonb('rated_skills'),                                          // page 5: { items: [{name, description?, evidence_source?, sub_competency_id?: string|null, rating}], generatedAt }
  sourceFiles: jsonb('source_files'),                                          // [{kind, fileName, key, extractedText?}]
  sessionId: uuid('session_id'),                                               // page 6 interview session (null until page 6 starts)
  profile: jsonb('profile'),                                                   // PositionProfile JSON (null until submitted+interviewed)
  model: text('model'),                                                        // synthesis model name
  completeness: text('completeness'),                                          // 'title-only' | 'structured' | 'rated' | 'interviewed'
  supersedes: uuid('supersedes'),                                              // self-FK; set when partner re-captures
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  partnerTargetIdx: index('idx_position_captures_partner_target').on(table.partnerId, table.careerTargetId, table.createdAt),
  targetStatusIdx: index('idx_position_captures_target_status').on(table.careerTargetId, table.status),
  supersedesIdx: index('idx_position_captures_supersedes').on(table.supersedes),
  supersedesFk: foreignKey({ columns: [table.supersedes], foreignColumns: [table.id], name: 'fk_position_captures_supersedes' }).onDelete('set null'),
}));

/**
 * Direct, skill-tagged course→course prerequisite edges. One row per
 * (focalCourse, prereqCourse, subCompetency) the focal course relies on.
 * Edges are DIRECT only; transitivity is derived by traversal, never authored.
 * Migration 0030. Design: docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md
 */
export const prerequisiteEdges = pgTable('prerequisite_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  focalCourseCode: text('focal_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  prereqCourseCode: text('prereq_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  expectedK: integer('expected_k'),       // depth the focal course relies on incoming; nullable per dim
  expectedU: integer('expected_u'),
  expectedD: integer('expected_d'),
  source: text('source').notNull(),                                  // 'llm_seed' | 'faculty'
  confidence: text('confidence').notNull(),                          // 'high' | 'medium' | 'low'
  confirmed: boolean('confirmed').notNull().default(false),
  rationale: text('rationale').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique('uq_prerequisite_edges_focal_prereq_subcomp').on(t.focalCourseCode, t.prereqCourseCode, t.subCompetencyId),
  focalIdx: index('idx_prerequisite_edges_focal').on(t.focalCourseCode),
  prereqIdx: index('idx_prerequisite_edges_prereq').on(t.prereqCourseCode),
}));

/**
 * Clemson catalog prerequisites, copied from the clemson-advising project's
 * catalog.db by scripts/catalog/sync-catalog-prereqs.ts (never read at
 * runtime). Migration 0053 (hand-written). Precedence over the course sheet:
 * lib/curriculum/prereq-map.ts. An entries row with no edges = "catalog lists
 * no course prerequisites" (no sheet fallback for that course).
 */
export const courseCatalogEntries = pgTable('course_catalog_entries', {
  courseCode: text('course_code').primaryKey(),
  title: text('title'),
  // Full-catalog course info (2026-10-07 access-panel addendum, migration
  // 0055): populated for EVERY Clemson course by scripts/catalog/sync-catalog-courses.ts,
  // not just the GC+tracked subset sync-catalog-prereqs.ts scopes itself to.
  description: text('description'),
  credits: text('credits'), // text: catalog credits can be a range, e.g. "1-3"
  prereqText: text('prereq_text'),
  coreqText: text('coreq_text'),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  catalogYear: text('catalog_year').notNull(),
  sourceUrl: text('source_url'),
  catalogLastSynced: text('catalog_last_synced'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseCatalogPrereqs = pgTable('course_catalog_prereqs', {
  courseCode: text('course_code').notNull(),
  prereqCode: text('prereq_code').notNull(),
  kind: text('kind').$type<'prereq' | 'concurrent_ok' | 'coreq'>().notNull(),
  anyOfGroup: smallint('any_of_group'),
  catalogYear: text('catalog_year').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.courseCode, t.prereqCode, t.kind] }),
  prereqIdx: index('idx_course_catalog_prereqs_prereq').on(t.prereqCode),
}));

/**
 * Syllabus-rough INTENDED coverage — "what the course says it teaches", a
 * different quantity from measured attainment. Evidence-ladder band: claimed.
 * NEVER merged into snapshot_competency_coverage. Migration 0031.
 * Design: docs/superpowers/specs/2026-06-05-intended-skills-rough-pass-design.md
 */
export const courseIntendedCoverage = pgTable('course_intended_coverage', {
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  intendedK: integer('intended_k'),
  intendedU: integer('intended_u'),
  intendedD: integer('intended_d'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull().default(''),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.courseCode, t.subCompetencyId] }),
  courseIdx: index('idx_course_intended_coverage_course').on(t.courseCode),
}));

/**
 * Derived: per-career-target KUD+ aggregate, recomputed from non-superseded
 * position_captures with status='submitted' and completeness='interviewed'.
 * v1 aggregate function is deterministic Markdown side-by-side (no AI);
 * v2 may swap in AI synthesis.
 */
export const careerTargetKudAggregate = pgTable('career_target_kud_aggregate', {
  careerTargetId: text('career_target_id').primaryKey().references(() => careerTargets.id, { onDelete: 'cascade' }),
  aggregateMarkdown: text('aggregate_markdown').notNull(),
  derivedFromPositionIds: jsonb('derived_from_position_ids').$type<string[]>().notNull(),
  stale: boolean('stale').notNull().default(false),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Numeric, per-sub-competency employer DEMAND for a career target — the
// demand-measurement side of the Q1 sufficiency seam. Partner-weighted average
// of position required_for_success depths, keyed to the target's structured
// sub-competencies via each position competency's sub_competency_id. Fractional
// (weighted), nullable per dimension (null = no_demand, NOT zero). Distinct from
// careerTargetKudAggregate (markdown narrative) and from proposedKUDEdits
// (definition-refinement). Spec: docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md
export const careerTargetDemand = pgTable('career_target_demand', {
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  kDemand: real('k_demand'),
  uDemand: real('u_demand'),
  dDemand: real('d_demand'),
  contributingPositionIds: jsonb('contributing_position_ids').$type<string[]>().notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.careerTargetId, t.subCompetencyId] })]);

export const flagTargetKind = pgEnum('flag_target_kind', ['coverage_cell', 'profile_competency']);
export const flagStatus = pgEnum('flag_status', ['open', 'resolved']);

/** The reading as it stood when flagged (drift baseline). */
export interface FlaggedContext {
  k: number | null;
  u: number | null;
  d: number | null;
  matchedCompetency?: string | null;
  rationale?: string | null;
  statement?: string | null;
  source?: string | null;
}

/**
 * Faculty dispute flags on AI readings. Keyed by STABLE identifiers — never
 * by snapshot/cell rows (cells are upsert-overwritten on re-score and deleted
 * on descriptor change; re-captures mint new snapshot ids):
 *   coverage_cell       → (courseCode, careerTargetId, subCompetencyId)
 *   profile_competency  → (courseCode, competencyStatement)
 * `flaggedContext` freezes the reading AS DISPUTED so read-time drift
 * ("was D=4 → now D=2") stays computable after re-scores. Flags never
 * auto-clear; resolution is explicit (name + note + date) and kept forever.
 * Migration 0034. Design: docs/superpowers/specs/2026-06-12-faculty-flag-mechanism-design.md
 */
export const facultyFlags = pgTable('faculty_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetKind: flagTargetKind('target_kind').notNull(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').references(() => careerTargets.id, { onDelete: 'cascade' }),   // cell flags only
  subCompetencyId: text('sub_competency_id').references(() => subCompetencies.id, { onDelete: 'cascade' }), // cell flags only
  competencyStatement: text('competency_statement'),                                                        // profile flags only
  note: text('note').notNull(),
  flaggedBy: text('flagged_by').notNull(),
  flaggedContext: jsonb('flagged_context').$type<FlaggedContext | null>(),
  status: flagStatus('status').notNull().default('open'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  cellIdx: index('idx_faculty_flags_cell').on(t.courseCode, t.careerTargetId, t.subCompetencyId),
  statusIdx: index('idx_faculty_flags_status').on(t.status),
}));

/**
 * Explore-side what-if IMPACT scenarios. One row per run of runImpact().
 * Stores the full Scenario shape (change + predicted deltas + ripple) in JSONB
 * columns. Never modifies capture-side tables; pure analytical scratch-space.
 * Migration 0046.
 */
export const courseExploreScenarios = pgTable('course_explore_scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  baselineSnapshotId: text('baseline_snapshot_id').notNull(),
  change: jsonb('change').notNull(),
  predictedDeltas: jsonb('predicted_deltas').notNull(),
  computedRipple: jsonb('computed_ripple').notNull(),
  agentNotes: text('agent_notes'),
  caption: text('caption'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  courseIdx: index('idx_course_explore_scenarios_course').on(t.courseCode),
}));
