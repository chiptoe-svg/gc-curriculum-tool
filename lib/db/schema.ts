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
  courseLabel: text('course_label'),                 // label of the course being analyzed
  courseSyllabus: text('course_syllabus').notNull(), // syllabus of the course being analyzed
  priorCoursework: jsonb('prior_coursework').$type<Array<{ courseLabel: string; syllabus: string }>>().notNull(), // all prior courses
  result: jsonb('result').notNull(),                 // the full AnalysisResult object
  aiProvider: text('ai_provider').notNull(),
  aiModel: text('ai_model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(), // estimated cost in 1/100 of a cent
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
});

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

export const partnerSessions = pgTable('partner_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
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
  costUsdCents: integer('cost_usd_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
