import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { BundlePosition } from '@/lib/db/schema';
import type { BundleSummary, CardFields } from '@/lib/catalog/bundles';
import type { TaskGroup } from '@/lib/catalog/shortlist';
import { formatDescriptorLines } from '@/lib/catalog/descriptors';

/**
 * Task 8 — the bundle-map-onet placement call: one bundle's card plus every
 * loaded O*NET element (grouped by domain) plus its top-K task-group
 * shortlist, placed by the model into core/related/fringe. See
 * docs/superpowers/sdd/2026-10-13-competency-catalog-p2/task-8-brief.md.
 *
 * Unknown ids (not in the input) are dropped (`droppedIds`). `noCleanMatch`
 * is derived, never trusted from the model (plan Ruling 6): true iff, after
 * validation, no placement is `core` or `related`. A placed task group
 * expands to one row per underlying (task_id, onet_soc_code) (plan Ruling 5);
 * a placed element expands to exactly one row with `onetSocCode: null`.
 */

export const BUNDLE_MAP_PROMPT_VERSION = 'bundle-map-onet@2';
// Lives in lib/catalog/shortlist (no provider SDK) so the DB layer and admin routes can import it.
export { TASK_SHORTLIST_K } from '@/lib/catalog/shortlist';
const POSITIONS = ['core', 'related', 'fringe'] as const;

export interface ElementDef { elementId: string; elementName: string; domain: string; description: string }
export interface PlacementInput { bundle: BundleSummary; card: CardFields; elements: ElementDef[]; tasks: Array<TaskGroup & { rank: number }>; release: string }
export interface MemberRow { source: 'onet_element' | 'onet_task'; externalId: string; externalLabel: string; onetSocCode: string | null; release: string; position: BundlePosition; rationale: string }
export interface PlacementResult { rows: MemberRow[]; noCleanMatch: boolean; note: string | null; droppedIds: string[]; model: string; costUsdCents: number }

const resultSchema = z.object({
  placements: z.array(z.object({ item_id: z.string().min(1), position: z.enum(POSITIONS), rationale: z.string().min(1) })),
  note: z.string().nullable(),
});

export const PLACEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['placements', 'note'],
  properties: {
    placements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item_id', 'position', 'rationale'],
        properties: {
          item_id: { type: 'string', minLength: 1 },
          position: { type: 'string', enum: [...POSITIONS] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
    note: { type: ['string', 'null'] },
  },
} as const;

const DOMAIN_ORDER = ['knowledge', 'transferable_skills', 'essential_skills', 'abilities', 'work_activities'];

export function buildPlacementUserMessage(input: PlacementInput): string {
  const { bundle, card } = input;
  const lines: string[] = [
    `**Bundle id:** ${bundle.id}`,
    `**Name:** ${bundle.name}`,
    ...formatDescriptorLines(bundle).map(l => l.replace(/^([^:]+):/, '**$1:**')),
    `**Includes:** ${card.includes}`,
    `**Excludes:** ${card.excludes}`,
    `**Distinctions:** ${card.distinctions}`,
    `**Belongs here (examples):** ${card.positiveExamples.join('; ')}`,
    `**Does not belong here (examples):** ${card.negativeExamples.join('; ')}`,
    '',
    '---',
    '',
    '## O*NET elements (all of them)',
  ];
  const byDomain = new Map<string, ElementDef[]>();
  for (const e of input.elements) byDomain.set(e.domain, [...(byDomain.get(e.domain) ?? []), e]);
  for (const domain of [...byDomain.keys()].sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))) {
    lines.push('', `### ${domain}`);
    for (const e of [...byDomain.get(domain)!].sort((a, b) => a.elementId.localeCompare(b.elementId))) {
      lines.push(`- E:${e.elementId} — ${e.elementName}: ${e.description}`);
    }
  }
  lines.push('', '## O*NET task statements (shortlisted)');
  for (const t of [...input.tasks].sort((a, b) => a.rank - b.rank)) lines.push(`- T${t.rank} — ${t.label}`);
  lines.push('', 'Place items into this bundle per the system instructions.');
  return lines.join('\n');
}

export function interpretPlacements(
  input: PlacementInput,
  raw: { placements: Array<{ item_id: string; position: BundlePosition; rationale: string }>; note: string | null },
): Omit<PlacementResult, 'model' | 'costUsdCents'> {
  const elements = new Map(input.elements.map(e => [`E:${e.elementId}`, e]));
  const tasks = new Map(input.tasks.map(t => [`T${t.rank}`, t]));
  const seen = new Set<string>();
  const rows: MemberRow[] = [];
  const droppedIds: string[] = [];
  let anyCoreOrRelated = false;
  for (const p of raw.placements) {
    if (seen.has(p.item_id)) continue;
    seen.add(p.item_id);
    const el = elements.get(p.item_id);
    const task = tasks.get(p.item_id);
    if (el) {
      rows.push({ source: 'onet_element', externalId: el.elementId, externalLabel: el.elementName, onetSocCode: null, release: input.release, position: p.position, rationale: p.rationale });
    } else if (task) {
      for (const m of task.members) {
        rows.push({ source: 'onet_task', externalId: m.taskId, externalLabel: task.label, onetSocCode: m.onetSocCode, release: input.release, position: p.position, rationale: p.rationale });
      }
    } else {
      droppedIds.push(p.item_id);
      continue;
    }
    if (p.position !== 'fringe') anyCoreOrRelated = true;
  }
  return { rows, noCleanMatch: !anyCoreOrRelated, note: raw.note, droppedIds };
}

export async function placeBundle(input: PlacementInput): Promise<PlacementResult> {
  const provider = await getProviderForFunction('bundle-map-onet');
  const systemPrompt = await loadPrompt('bundle-map-onet');
  const result = await provider.complete<z.infer<typeof resultSchema>>({
    systemPrompt,
    userMessage: buildPlacementUserMessage(input),
    schemaName: 'bundle_placement_v1',
    jsonSchema: PLACEMENT_JSON_SCHEMA as unknown as object,
    validate: (raw: unknown) => resultSchema.parse(raw),
  });
  return { ...interpretPlacements(input, result.data), model: provider.model, costUsdCents: result.costUsdCents };
}
