/**
 * The staged interviewer's tools and reply schema (plan 2026-11-25, Task 6).
 *
 * - `submit_turn` (StagedSubmit): the reply. runPiTurn adds it from `submit`; it is not built here.
 * - `record_answer`: settles a slot. Validated against the live ledger (the slot must exist for this map and
 *   these anchors; status never `not_reached`). Accepted calls push a `record` event into `live.events` so
 *   later checks in the same turn see them, and their args are remembered in `live.accepted` so only accepted
 *   calls are stored (the stored calls are what the ledger is rebuilt from).
 * - `load_skill`: situational skills only.
 * - `note_for_lead`: a topic outside the profile; stored with the turn's tool calls, never a question.
 * - `search_materials`, `fetch_material_section`: from buildAuditTools.
 */
import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { buildAuditTools } from '@/lib/ai/agent/audit-tools';
import { SITUATIONAL_SKILLS, loadSkill } from '@/lib/ai/skills/load-skill';
import type { AuditCitation } from '@/lib/ai/agent/audit-response-schema';
import type { EvidenceMap } from './evidence-map';
import { anchorFallback, buildLedger, type LedgerEvent, type SlotRecord } from './ledger';
import { engineState } from './engine';

export type StagedKind = 'question' | 'follow_up' | 'recap' | 'answer_only';

export type StagedSubmit = {
  say: string;
  question: string;
  citations: AuditCitation[];
  slot_asked: string;
  kind: StagedKind;
};

const CitationArg = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().nullable(),
  messageId: z.string().nullable(),
  excerpt: z.string(),
});

/** Parsed after repairCitations (which trims excerpts to 200 characters). */
export const StagedSubmitSchema = z.object({
  say: z.string(),
  question: z.string(),
  citations: z.array(CitationArg.extend({ excerpt: z.string().max(200) })),
  slot_asked: z.string(),
  kind: z.enum(['question', 'follow_up', 'recap', 'answer_only']),
}) satisfies z.ZodType<StagedSubmit>;

const citationJson = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['chunk', 'instructor'] },
    chunkId: { type: ['string', 'null'] },
    messageId: { type: ['string', 'null'] },
    excerpt: { type: 'string' },
  },
  required: ['type', 'chunkId', 'messageId', 'excerpt'],
  additionalProperties: false,
} as const;

/** OpenAI strict: every property required, optional values nullable. No excerpt limit (repairCitations trims). */
export const StagedSubmitJsonSchema = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    question: { type: 'string' },
    citations: { type: 'array', items: citationJson },
    slot_asked: { type: 'string' },
    kind: { type: 'string', enum: ['question', 'follow_up', 'recap', 'answer_only'] },
  },
  required: ['say', 'question', 'citations', 'slot_asked', 'kind'],
  additionalProperties: false,
} as const;

export const STAGED_SUBMIT_DESCRIPTION =
  'Deliver this turn: `say` (acknowledgment or finding, with citations), the one `question` (empty only for answer_only, once the interview is complete), '
  + 'the `slot_asked` it targets and its `kind`. Call last, once, after any record_answer calls.';

/** record_answer's arguments, as stored in capture_messages.tool_calls and read back to rebuild the ledger. */
export const RecordAnswerArgs = z.object({
  slot: z.string().min(1),
  status: z.enum(['filled_from_materials', 'filled_by_instructor', 'unknown']),
  summary: z.string(),
  citations: z.array(CitationArg),
});

export function toSlotRecord(args: z.infer<typeof RecordAnswerArgs>): SlotRecord {
  return {
    slot: args.slot,
    status: args.status,
    summary: args.summary,
    citations: args.citations.map(c => ({ type: c.type, chunkId: c.chunkId ?? null, messageId: c.messageId ?? null, excerpt: c.excerpt })),
  };
}

/** The ledger as it stands during a turn: the stored events plus this turn's accepted records. */
export type LiveLedger = {
  map: EvidenceMap | null;
  events: LedgerEvent[];
  /** Args objects of accepted record_answer calls (runPiTurn passes the same object to the tool and toolCallsUsed). */
  accepted: WeakSet<object>;
  bloom: boolean;
  /** The app's anchors record (Task 9b fix 2), and the accepted record_answer args it follows (null: start of turn). */
  appAnchors?: { after: object | null; args: z.infer<typeof RecordAnswerArgs> } | null;
};

/**
 * Task 9b fix 2: when stage 1 has just closed without instructor anchors, record them from the evidence map
 * (filled_from_materials) into the live ledger. Returns a note for the model, or null when nothing was recorded.
 * At most once per turn; once recorded the fallback no longer applies to later turns.
 */
export function applyAnchorFallback(live: LiveLedger, after: object | null): string | null {
  if (live.appAnchors) return null;
  const summary = anchorFallback(live.map, buildLedger(live.map, live.events));
  if (!summary) return null;
  const args = { slot: 'anchors', status: 'filled_from_materials' as const, summary, citations: [] };
  live.events.push({ type: 'record', record: toSlotRecord(args) });
  live.appAnchors = { after, args };
  const state = engineState(live.map, buildLedger(live.map, live.events));
  return `Stage 1 closed without anchors from the instructor, so the app recorded them from the materials: ${summary.split('\n').join('; ')}. `
    + `The interview is now at stage ${state.stage}. Open: ${state.openSlots.join(', ')}. Name these anchors and ask about the first.`;
}

const STAGED_SEARCH_TOOLS = new Set(['search_materials', 'fetch_material_section']);

export function buildStagedTools(courseCode: string, live: LiveLedger): ToolDefinition[] {
  const search = buildAuditTools(courseCode).filter(t => STAGED_SEARCH_TOOLS.has(t.name));

  const record_answer: ToolDefinition = {
    name: 'record_answer',
    description: 'Settle one interview slot with what the instructor said or what the materials show. Call before submit_turn, once per slot the answer settles.',
    usagePolicy:
      'status is filled_from_materials (with a chunk citation), filled_by_instructor (cite the instructor message) or unknown '
      + '(the instructor skipped or does not know). The summary is a plain sentence or two in the instructor\'s terms. '
      + 'Recording a slot again replaces its summary.',
    // Status is not limited in the schema so a not_reached gets a clear error instead of a schema failure.
    inputSchema: RecordAnswerArgs.extend({ status: z.enum(['filled_from_materials', 'filled_by_instructor', 'unknown', 'not_reached']) }),
    async execute(raw) {
      const args = raw as { slot: string; status: string };
      if (args.status === 'not_reached') return 'error: not_reached is set by the app; use unknown if the instructor did not answer.';
      const state = engineState(live.map, buildLedger(live.map, live.events));
      if (!state.allSlots.includes(args.slot)) {
        return `error: "${args.slot}" is not a slot in this interview. Slots: ${state.allSlots.join(', ')}.`;
      }
      // Task 9b fix 4: the recap answer exists only after the recap was shown.
      if (args.slot === 'recap' && !buildLedger(live.map, live.events).asked.some(t => t.kind === 'recap')) {
        return 'error: the recap has not been asked yet. Ask it first (kind recap, slot recap); record the instructor\'s reply to it afterwards.';
      }
      const parsed = RecordAnswerArgs.safeParse(raw);
      if (!parsed.success) return `error: ${parsed.error.issues.map(i => i.message).join('; ')}`;
      live.events.push({ type: 'record', record: toSlotRecord(parsed.data) });
      if (raw && typeof raw === 'object') live.accepted.add(raw);
      const note = applyAnchorFallback(live, raw && typeof raw === 'object' ? raw : null);
      return note ? `recorded. ${note}` : 'recorded';
    },
  };

  const load_skill: ToolDefinition = {
    name: 'load_skill',
    description: `Load a situational interview skill: ${SITUATIONAL_SKILLS.join(', ')}. Returns its instructions.`,
    inputSchema: z.object({ name: z.string() }),
    async execute(raw) {
      const { name } = raw as { name: string };
      if (!(SITUATIONAL_SKILLS as readonly string[]).includes(name)) {
        return `error: "${name}" is not a skill you can load. Choose one of: ${SITUATIONAL_SKILLS.join(', ')}.`;
      }
      return loadSkill(name, { bloom: live.bloom }).body;
    },
  };

  const note_for_lead: ToolDefinition = {
    name: 'note_for_lead',
    description: 'Pass a topic outside the course profile (a study idea, a department issue, another course\'s problem) to the department lead. Then tell the instructor you passed it on and move on.',
    inputSchema: z.object({ note: z.string().min(1) }),
    async execute() {
      return 'noted';
    },
  };

  return [...search, record_answer, load_skill, note_for_lead];
}
