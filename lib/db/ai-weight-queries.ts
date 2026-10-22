/**
 * AI-drafted provisional weights (spec 2026-10-21-p3-ai-draft-weights-design.md).
 * One `ai` entry row per (target, competency): weight 0–1 on the O*NET
 * importance scale, note "AI draft (<model>): <reason>". The effective weight
 * prefers it over O*NET/employer until a faculty override exists. The recompute
 * never touches these rows; this import writes them under the membership lock
 * and rebuilds membership in the same transaction.
 */
import { sql } from 'drizzle-orm';
import { careerTargetRequirements } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import { lockMembership, rebuildMembership, readEntryRows, pairStatesFromRows, type MembershipChange } from '@/lib/db/membership-queries';

export const AI_NOTE_PREFIX = 'AI draft';
export interface AiRating { target: string; competency: string; weight: number; reason: string }
export interface ParsedAiRatings { model: string; ratings: AiRating[] }

/** Validates a ratings file: every known target × competency exactly once, weights 0–1, a reason each. Throws on any problem. */
export function parseAiRatings(raw: unknown, known: { targets: string[]; competencies: string[] }): ParsedAiRatings {
  const o = raw as { model?: unknown; ratings?: unknown };
  if (typeof o?.model !== 'string' || !o.model.trim()) throw new Error('model is required');
  if (!Array.isArray(o.ratings)) throw new Error('ratings must be an array');
  const targets = new Set(known.targets);
  const comps = new Set(known.competencies);
  const seen = new Set<string>();
  const ratings: AiRating[] = [];
  for (const r of o.ratings as Array<Record<string, unknown>>) {
    const t = r?.target, c = r?.competency, w = r?.weight, reason = r?.reason;
    if (typeof t !== 'string' || !targets.has(t) || typeof c !== 'string' || !comps.has(c)) throw new Error(`unknown target or competency: ${String(t)} / ${String(c)}`);
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1) throw new Error(`weight out of range for ${t} / ${c}`);
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`reason missing for ${t} / ${c}`);
    const k = `${t}|${c}`;
    if (seen.has(k)) throw new Error(`duplicate rating for ${t} / ${c}`);
    seen.add(k);
    ratings.push({ target: t, competency: c, weight: w, reason: reason.trim() });
  }
  for (const t of known.targets) for (const c of known.competencies) {
    if (!seen.has(`${t}|${c}`)) throw new Error(`missing rating for ${t} / ${c}`);
  }
  return { model: o.model.trim(), ratings };
}

export function aiNote(model: string, reason: string): string {
  return `${AI_NOTE_PREFIX} (${model}): ${reason}`;
}

/** The reason part of an `ai` row's note, or null. */
export function aiReason(note: string | null | undefined): string | null {
  if (!note || !note.startsWith(AI_NOTE_PREFIX)) return null;
  const i = note.indexOf('): ');
  return i >= 0 ? note.slice(i + 3) : null;
}

export interface AiImportReport { upserted: number; changes: MembershipChange[] }

export async function importAiWeights(ex: Executor, parsed: ParsedAiRatings, opts: { apply: boolean }): Promise<AiImportReport> {
  if (opts.apply) await lockMembership(ex);
  const rows = parsed.ratings.map(r => ({
    careerTargetId: r.target, competencyId: r.competency, horizon: 'entry' as const, weightSource: 'ai' as const,
    weight: r.weight, status: 'draft' as const, displayOrder: 0, note: aiNote(parsed.model, r.reason),
  }));
  if (!opts.apply) {
    // Decide membership from in-memory rows: current entry rows with the ai rows replaced.
    const current = (await readEntryRows(ex)).filter(r => r.source !== 'ai');
    const states = pairStatesFromRows([...current, ...rows.map(r => ({ t: r.careerTargetId, c: r.competencyId, source: 'ai' as const, weight: r.weight, status: 'draft' as const, order: 0, n: 0, note: r.note }))]);
    return { upserted: rows.length, changes: await rebuildMembership(ex, { apply: false, states }) };
  }
  for (let i = 0; i < rows.length; i += 500) {
    await ex.insert(careerTargetRequirements).values(rows.slice(i, i + 500)).onConflictDoUpdate({
      target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
      set: { weight: sql`excluded.weight`, note: sql`excluded.note`, updatedAt: sql`now()` },
    });
  }
  return { upserted: rows.length, changes: await rebuildMembership(ex) };
}
