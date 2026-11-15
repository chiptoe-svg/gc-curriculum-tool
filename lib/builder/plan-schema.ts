// What a saved plan may contain. Shapes and size limits only: a ref or a
// competency id that matches nothing is simply ignored by computePlan.
import { z } from 'zod';
import type { PlanState } from './types';

const id = z.string().min(1).max(80);
const text = (max: number) => z.string().max(max);
const level = z.number().int().min(0).max(5).nullable();
const depth = z.object({ k: level, u: level, d: level });
const act = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const link = z.object({ from: id, to: id });
/** A card position in map pixels; generous, but bounded. */
const coord = z.number().finite().min(0).max(20000);
const slot = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const height = z.number().finite().min(80).max(6000).nullable();

export const planStateSchema = z.object({
  goal: z.object({
    targetIds: z.array(id).max(20),
    levels: z.record(id, z.record(id, z.tuple([depth.nullable(), depth.nullable(), depth.nullable()]))),
    added: z.array(id).max(100),
    removed: z.array(id).max(100),
    written: z.array(z.object({
      id, act, targetId: id.nullable(), text: text(500), competencyIds: z.array(id).max(20),
    })).max(100),
    program: z.object({ off: z.array(id).max(200) }).optional(),
  }),
  lens: z.enum(['discovered', 'stated']),
  fill: z.boolean(),
  fade: z.number().min(0).max(2),
  support: z.boolean(),
  placements: z.array(z.object({ ref: id, act, branch: id.nullable(), slot: slot.optional(), x: coord.optional() })).max(200),
  heights: z.tuple([height, height, height]).optional(),
  degreeHours: z.number().int().min(1).max(300).optional(),
  catalogYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  requirements: z.array(z.object({
    id, label: text(300), credits: z.number().min(0).max(30).nullable(), options: z.array(text(40)).max(20),
    genEd: text(80).nullable(), notes: z.array(text(2000)).max(10),
  })).max(60).optional(),
  branches: z.array(z.object({ id, name: text(60), targetIds: z.array(id).max(20) })).max(12),
  links: z.array(link).max(300),
  unlinked: z.array(link).max(300),
  proposed: z.array(z.object({
    id, source: z.enum(['new', 'catalog']), code: text(40), credits: text(20).nullable(), title: text(160),
    description: text(4000), objectives: z.array(text(500)).max(40),
    depths: z.array(depth.extend({ competencyId: id })).max(100),
  })).max(60),
  versions: z.record(id, id),
});

export const NAME_MAX = 120;

export function parsePlanState(input: unknown): PlanState | null {
  const r = planStateSchema.safeParse(input);
  return r.success ? (r.data as PlanState) : null;
}
