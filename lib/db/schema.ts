import { pgTable, pgEnum, uuid, text, jsonb, timestamp, integer, bigint, real, boolean, primaryKey, index, unique, foreignKey } from 'drizzle-orm/pg-core';
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
  // Indexing pipeline status: 'pending' | 'indexing' | 'ready' | 'failed' | 'skipped'.
  indexingStatus: text('indexing_status').notNull().default('pending'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  // Set true to keep the material in the system but exclude it from AI context
  // (CourseCapture chat + scoring) — useful for Canvas imports that turn out
  // to be duplicate, outdated, or irrelevant.
  ignored: boolean('ignored').notNull().default(false),
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
  // Departmental-context narrative copied from the draft profile's
  // reviewer_note at snapshot-creation time. Frozen with the snapshot
  // so the "why" behind overrides survives in the immutable record.
  // Substrate for the future curriculum-wiki layer.
  reviewerNote: text('reviewer_note'),
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

// Program-level coverage matrix: one row per (snapshot × career-target ×
// sub-competency). Populated by an AI scoring pass that maps the snapshot's
// discovered competencies to the canonical sub-competency space. Read by
// the program coverage matrix view and the scaffolding analysis.
//
// Idempotent: UNIQUE(snapshot, target, sub_competency) means a re-score
// overwrites the cell rather than duplicating it.
export const snapshotTargetCoverage = pgTable('snapshot_target_coverage', {
  snapshotId: uuid('snapshot_id').notNull().references(() => courseCaptureSnapshots.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth').notNull(),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.snapshotId, t.careerTargetId, t.subCompetencyId] }),
}));

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

// What-if scenarios — given a (snapshot, target, optional analysis) and a
// proposed change in prose, predict which competencies move and how the
// alignment shifts. Doesn't modify any capture-side data; pure playground.
export const courseExploreWhatIfs = pgTable('course_explore_what_ifs', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').notNull().references(() => courseCaptureSnapshots.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => courseExploreTargets.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id').references(() => courseExploreAnalyses.id, { onDelete: 'set null' }),
  changeProse: text('change_prose').notNull(),
  result: jsonb('result').notNull(),
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
 * Syllabus-rough INTENDED coverage — "what the course says it teaches", a
 * different quantity from measured attainment. Evidence-ladder band: claimed.
 * NEVER merged into snapshot_target_coverage. Migration 0031.
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
