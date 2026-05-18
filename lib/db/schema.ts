import { pgTable, uuid, text, jsonb, timestamp, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';

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
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  knowDescriptor: text('know_descriptor').notNull(),
  understandDescriptor: text('understand_descriptor').notNull(),
  doDescriptor: text('do_descriptor').notNull(),
  displayOrder: integer('display_order').notNull(),
  retired: boolean('retired').default(false).notNull(),  // soft delete so old coverage_scores don't orphan
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
  upstreamCourseLabel: text('upstream_course_label'),     // optional faculty-supplied
  downstreamCourseLabel: text('downstream_course_label'),
  upstreamSyllabus: text('upstream_syllabus').notNull(),
  downstreamSyllabus: text('downstream_syllabus').notNull(),
  result: jsonb('result').notNull(),                 // the full AnalysisResult object
  aiProvider: text('ai_provider').notNull(),
  aiModel: text('ai_model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(), // estimated cost in 1/100 of a cent
  durationMs: integer('duration_ms').notNull(),
});

export const prototypeFlags = pgTable('prototype_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  runId: uuid('run_id').notNull().references(() => prototypeRuns.id, { onDelete: 'cascade' }),
  flagType: text('flag_type').notNull(),             // 'coverage' | 'prerequisite_gap' | 'kud_draft'
  target: text('target').notNull(),                  // e.g., "upstream.sub_comp_id" or "gap.id"
  note: text('note').notNull(),
  resolved: boolean('resolved').default(false).notNull(),
});

export const dailyCost = pgTable('daily_cost', {
  day: text('day').primaryKey(),               // 'YYYY-MM-DD' UTC
  totalCostUsdCents: integer('total_cost_usd_cents').notNull().default(0),
  lastAlertSent: timestamp('last_alert_sent', { withTimezone: true }),
});

export const ipHourly = pgTable('ip_hourly', {
  ipHash: text('ip_hash').notNull(),
  hourKey: text('hour_key').notNull(),         // 'YYYY-MM-DDTHH' UTC
  count: integer('count').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.ipHash, t.hourKey] }),
}));
