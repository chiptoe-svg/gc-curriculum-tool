import { pgTable, uuid, text, jsonb, timestamp, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';
import type { CaptureProfile, CaptureReadiness, CaptureReviewerStatus } from '@/lib/ai/capture/schema';

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
  builderStatus: text('builder_status').notNull().default('draft'),
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
  analysisFinding: jsonb('analysis_finding').$type<{
    materialType: string;
    competencies: Array<{ name: string; description: string; evidenceQuotes: string[] }>;
    skills: string[];
    notes: string;
  }>(),
  analysisModel: text('analysis_model'),
  analysisCostUsdCents: integer('analysis_cost_usd_cents'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),
  // Set true to keep the material in the system but exclude it from AI context
  // (CourseCapture chat + scoring) — useful for Canvas imports that turn out
  // to be duplicate, outdated, or irrelevant.
  ignored: boolean('ignored').notNull().default(false),
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
  costUsdCents: integer('cost_usd_cents').notNull(),
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
  costUsdCents: integer('cost_usd_cents').notNull(),
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

export const coverageScores = pgTable('coverage_scores', {
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  kudLevel: text('kud_level').notNull(),           // 'know' | 'understand' | 'do' | 'none'
  confidence: integer('confidence').notNull(),     // 0–100
  reasoning: text('reasoning').notNull().default(''),
  sourceProfileRunId: uuid('source_profile_run_id').references(() => courseProfileRuns.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.courseCode, t.subCompetencyId] }),
}));

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
  scaleVersion: text('scale_version').notNull(),
  model: text('model').notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Explore-side persisted state. Two tables: targets (the "what should be"
// half of the comparison) and analyses (saved comparator runs).
// Both are write-only from Explore — never touch capture-side tables.

export const courseExploreTargets = pgTable('course_explore_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'custom' | 'downstream'
  spec: jsonb('spec').notNull(),
  caption: text('caption'),
  proseInput: text('prose_input'),
  authoredAgainstSnapshotId: uuid('authored_against_snapshot_id').references(() => courseCaptureSnapshots.id, { onDelete: 'set null' }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseExploreAnalyses = pgTable('course_explore_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').notNull().references(() => courseCaptureSnapshots.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => courseExploreTargets.id, { onDelete: 'cascade' }),
  analysis: jsonb('analysis').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
