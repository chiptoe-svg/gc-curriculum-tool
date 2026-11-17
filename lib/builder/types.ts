// Shared types for the curriculum builder (spec docs/superpowers/specs/2026-11-14-curriculum-builder-design.md).
// Pure: imported by both the server loader and the client.
import type { Area7Block } from '@/lib/ai/capture/area7-types';

export type Act = 1 | 2 | 3;
export const ACTS: ReadonlyArray<{ act: Act; name: string; verb: string; span: string }> = [
  { act: 1, name: 'Foundations & Agency', verb: 'Learn the field', span: 'Years 1–2' },
  { act: 2, name: 'Integration & Mastery', verb: 'Integrate the field', span: 'To mid-junior year' },
  { act: 3, name: 'Specialty & Application', verb: 'Apply a focus', span: 'Junior spring – senior year' },
];

/** Depth on the 0–5 scale; null = no reading on that dimension (never zero). */
export interface Depth { k: number | null; u: number | null; d: number | null }
/** A captured skill: one statement in a capture profile, with the level the capture gave it. Never changed downstream. */
export interface Skill { skillRef: string; statement: string; k: number | null; u: number | null; d: number | null }
/** A skill a course expects of students on entry: `ref` is the hash of its normalized statement. */
export interface RequiredSkill { ref: string; statement: string; need: Depth }
/** A developed skill that may supply a required one: top matches by embedding, with the judge's probabilities. */
export interface Candidate {
  requiredRef: string; suppliedRef: string; suppliedCourse: string; suppliedStatement: string;
  similarity: number; pFully: number | null; pPartly: number | null;
}
/** A faculty decision on a (required, supplied) pair. Keyed in Library.decisions by `${requiredRef}|${suppliedRef}`. */
export interface MatchDecision {
  requiredRef: string; suppliedRef: string; label: 'fully' | 'partly' | 'not'; by: string; at: string; draft: boolean;
}

/** A skill as linked to a catalog competency (spec 2026-11-15-skill-competency-links-design.md). */
export interface LinkedSkill extends Skill {
  source: 'embedding' | 'ai' | 'scoring' | 'faculty';
  status: 'proposed' | 'confirmed' | 'rejected';
  similarity: number | null;
}

/**
 * A course's level on one catalog competency. For a captured course read through links: `links` are the skills
 * counted toward it, `method` says how they were combined ('max' = the highest linked skill), and `soft` is set
 * when every link is still a proposal. `source`: the older scoring's matched statement, when links are not in use.
 */
export interface CompetencyDepth extends Depth {
  competencyId: string;
  source?: string | null;
  links?: LinkedSkill[];
  method?: 'max' | 'ai' | 'faculty';
  rationale?: string | null;
  soft?: boolean;
}

/** Which reading of a course the plan stacks. */
export type Lens = 'discovered' | 'stated';
/** Where a contribution came from. */
export type Basis = 'discovered' | 'stated' | 'proposed';

export interface LibraryVersion {
  snapshotId: string;
  instructorName: string | null;
  createdAt: string;
  /** Empty when the capture has not been scored against the competency catalog yet. */
  depths: CompetencyDepth[];
  /** Competency statements from the captured profile, for the detail panel. */
  outcomes: Array<{ statement: string; k: number | null; u: number | null; d: number | null }>;
  /** The capture's own findings where stated objectives and evidence part ways. */
  disagreements: string[];
  /** Major projects from the captured profile. */
  projects: Array<{ title: string; description: string; deliverables: string[] }>;
  /** The capture's problem-solving conditions (Audit Area 7); null when not recorded or captured before they were. */
  conditions: Area7Block | null;
  /** Every skill in the capture, and those with no counting link (links in use only; empty otherwise). */
  skills: Skill[];
  /** What the capture says students must bring in (incoming expectations). */
  required: RequiredSkill[];
  unmapped: Skill[];
  /** Embedding matches awaiting a decision: shown as suggestions, not counted. */
  suggestions: Array<LinkedSkill & { competencyId: string }>;
  /** Whether the levels come from links (true) or from the older catalog scoring (false). */
  linked: boolean;
}

/** A what-if on a course (one with a finished page): the course as it would read if the change were made. */
export interface LibraryWhatIf {
  id: string;
  title: string;
  author: string;
  depths: CompetencyDepth[];
  /** Changed ratings the what-if could not tie to a competency; they are not in `depths`. */
  notComputed: string[];
}

export interface LibraryCourse {
  code: string;
  title: string;
  level: number;
  category: string;
  track: string;
  /** Catalog description (falls back to the course sheet's). */
  description: string;
  credits: string | null;
  /** Wiki course page, when one exists. */
  wiki: { slug: string; summary: string } | null;
  /** Stated learning objectives, as written on the course sheet. */
  objectives: string[];
  /** Major projects as the course sheet lists them (used when no capture records any). */
  sheetProjects: string[];
  /** Depths read from the syllabus (what the course says it teaches). Empty = no reading. */
  stated: CompetencyDepth[];
  /** Captured versions, newest first, one per instructor. Empty = not captured. */
  versions: LibraryVersion[];
  whatIfs: LibraryWhatIf[];
}

export interface LibraryCompetency {
  id: string;
  name: string;
  foundational: boolean;
  /** The bundle card's stratum (technical, business, workflow_ai, foundational); null when it has no card. */
  stratum: string | null;
  /** Related competencies in the same stratum, nearest first, from the bundle-card embeddings. */
  neighbors: string[];
  know: string | null;
  understand: string | null;
  do: string;
}

export interface LibraryTarget {
  id: string;
  name: string;
  shortDefinition: string;
  /** Member competencies with the entry weight (null = pinned without a weight). */
  members: Array<{ competencyId: string; weight: number | null }>;
}

export interface LibraryPrereq {
  courseCode: string;
  prereqCode: string;
  kind: 'prereq' | 'concurrent_ok';
  anyOfGroup: number | null;
}

export interface Library {
  courses: LibraryCourse[];
  competencies: LibraryCompetency[];
  targets: LibraryTarget[];
  prereqs: LibraryPrereq[];
  /** Top matches per required skill, by `${courseCode}|${requiredRef}` (each list excludes that course's own skills); empty before migration 0069. */
  candidates: Record<string, Candidate[]>;
  /** Faculty decisions (non-draft), by `${requiredRef}|${suppliedRef}`; empty before migration 0069. */
  decisions: Record<string, MatchDecision>;
}

export interface ProposedCourse {
  id: string;            // 'new:<random>'
  /** 'new' = invented in this plan; 'catalog' = pulled from the Clemson catalog, not yet tracked by the tool. */
  source: 'new' | 'catalog';
  code: string;          // free label for a new course, the catalog code otherwise
  credits: string | null;
  title: string;
  description: string;
  objectives: string[];
  depths: CompetencyDepth[];
}

/**
 * Each act holds three terms: nine in all (eight semesters and a summer), numbered 1–9 from the bottom of
 * Act 1. A course sits in one term; fade is counted term by term, each term treated as a semester (owner,
 * 2026-11-15).
 */
export const TERMS_PER_ACT = 3;
/** 0 = the act's first term (bottom row on the map), 2 = its last (top row). */
export type Slot = 0 | 1 | 2;
export const termOf = (act: Act, slot: Slot): number => (act - 1) * TERMS_PER_ACT + slot + 1;

/**
 * `branch` null = the trunk every student takes; otherwise the id of the branch the course belongs to.
 * `slot`: the term within the act. `x`: the card's left edge in map pixels from its lane's left, at 100% zoom;
 * left to right is free and orders courses within a term. Both are absent until someone moves a card in that
 * lane; until then layoutLanes() places it (lib/builder/layout.ts).
 */
export interface Placement { ref: string; act: Act; branch: string | null; slot?: Slot; x?: number }

/**
 * A placeholder from a catalog plan: a requirement slot ("Arts and Humanities (Literature)", "Elective") or a
 * choice ("One of STAT 2220, STAT 2300"). It counts toward credit hours and, when it stands for a General
 * Education category (or every option of a choice is allowed in one), toward that category as planned.
 * It has no competency reading.
 */
export interface Requirement { id: string; label: string; credits: number | null; options: string[]; genEd: string | null; notes: string[] }

/** An alternative pathway that splits from the trunk and builds toward some of the plan's career paths. */
export interface Branch { id: string; name: string; targetIds: string[] }

/** "from must come before to", by course ref. `kind` absent = prerequisite; 'coreq' = may be taken together. */
export interface Link { from: string; to: string; kind?: 'prereq' | 'coreq' }

export const BLOOM = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'] as const;
export type BloomProcess = (typeof BLOOM)[number];

/** `origin`: 'syllabus' = drafted by the campus model from an uploaded syllabus; absent or 'faculty' = made by hand. */
export interface EditBase { id: string; by: string; at: string; origin?: 'syllabus' | 'faculty' }
/** A map-scoped change to a course objective; `target` is the original text (null for an add). Captures are never changed. */
export type ObjectiveEdit = EditBase & { action: 'add' | 'edit' | 'remove'; target: string | null; text: string | null; bloom: BloomProcess | null };
/**
 * A map-scoped change to a required or developed skill; `target` is the original ref (null for an add).
 * `conditionMissing`: a syllabus-drafted developed skill whose syllabus states no condition for Do, so its Do goal was held at 2.
 */
export type SkillEdit = EditBase & {
  action: 'add' | 'edit' | 'remove'; target: string | null; statement: string | null; levels: Depth | null; conditionMissing?: boolean;
};
/** Where a course's drafted items came from: a syllabus imported onto this map (plan_syllabus_drafts.id). */
export interface CourseEditsSource { kind: 'syllabus'; draftId: string; fileName: string; at: string }
export interface CourseEdits { objectives: ObjectiveEdit[]; required: SkillEdit[]; developed: SkillEdit[]; source?: CourseEditsSource }

/** Required depth at the end of Act 1, 2 and 3; null = nothing required at that checkpoint. */
export type ActLevels = [Depth | null, Depth | null, Depth | null];

/** A written objective for a checkpoint, checked through the competencies it is linked to. */
export interface WrittenObjective {
  id: string;
  act: Act;
  /** The career path it belongs to; null = the whole program. */
  targetId: string | null;
  text: string;
  competencyIds: string[];
}

/** Key in PlanGoal.levels for competencies added by hand rather than through a career path. */
export const PLAN_SCOPE = '_plan';

export interface PlanGoal {
  /** Career paths this plan builds toward. */
  targetIds: string[];
  /**
   * Required K/U/D per checkpoint: levels[careerTargetId | PLAN_SCOPE][competencyId].
   * A competency with no entry uses defaultLevels().
   */
  levels: Record<string, Record<string, ActLevels>>;
  /** Competencies added to / removed from the career paths' lists. */
  added: string[];
  removed: string[];
  written: WrittenObjective[];
  /**
   * Program targets, independent of any career path (owner, 2026-11-15): when present, every catalog
   * competency except those in `off` is judged against the plan's own targets (levels[PLAN_SCOPE]); a
   * chosen career path adds its own targets, and the stricter one counts. Absent = career paths only.
   */
  program?: { off: string[] };
}

export interface PlanState {
  goal: PlanGoal;
  lens: Lens;
  /** When a course has no reading under the chosen lens, use its other reading. */
  fill: boolean;
  /**
   * Levels a skill thread is assumed to lose per act when nothing reinforces it (0 = fade not counted). An assumption,
   * not a measurement. Applies only to skill threads (lib/builder/threads.ts), never to competency levels, act
   * checkpoints or targets (owner, 2026-11-16).
   */
  fade: number;
  /**
   * Kept in the stored plan but unused: it once let a related competency slow a competency's fade, and competencies
   * no longer fade (owner, 2026-11-16). Nothing reads it; the UI no longer offers it.
   */
  support: boolean;
  /**
   * Array order is teaching order within an act. When cards are moved on the map, the order is rewritten
   * from their positions (earlier term first, then left first: orderByPosition in lib/builder/layout.ts).
   */
  placements: Placement[];
  /** Credit hours the degree requires (the catalog program's total when the plan started from one); absent = 120. */
  degreeHours?: number;
  /** The catalog year the plan started from, e.g. "2026-2027"; its General Education rules are the ones checked. Absent = the newest. */
  catalogYear?: string;
  /** Placeholders from the catalog plan: requirement slots (Gen Ed, elective, specialty) and course choices. Placed like courses. */
  requirements?: Requirement[];
  /** Height in map pixels chosen for Act 1, 2 and 3 (null = automatic). Absent on plans saved before it existed. */
  heights?: [number | null, number | null, number | null];
  branches: Branch[];
  /** Dependencies added in this plan, on top of the catalog prerequisites. */
  links: Link[];
  /** Catalog prerequisites this plan sets aside. */
  unlinked: Link[];
  proposed: ProposedCourse[];
  /** Map-scoped edits per course ref (course code or proposed id). Absent on plans saved before they existed. */
  courseEdits?: Record<string, CourseEdits>;
  /** Chosen version per course code: a captured snapshot id, or `whatif:<id>` for a what-if; absent = newest capture. */
  versions: Record<string, string>;
}

export const EMPTY_PLAN: PlanState = {
  goal: { targetIds: [], levels: {}, added: [], removed: [], written: [], program: { off: [] } },
  lens: 'discovered',
  fill: true,
  fade: 1,
  support: false,
  placements: [],
  branches: [],
  links: [],
  unlinked: [],
  proposed: [],
  versions: {},
};

/** The fields a course map shares with the plan map: proposed courses, map-scoped edits, chosen versions, drawn and set-aside arrows. */
export type MapCore = Pick<PlanState, 'proposed' | 'courseEdits' | 'versions' | 'links' | 'unlinked'>;
