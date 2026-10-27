#!/usr/bin/env tsx
/**
 * One-time cleanup for the model-roles change (spec
 * docs/superpowers/specs/2026-10-27-model-roles-design.md): deletes custom
 * `ai_function_settings` rows that duplicate their function's role, so the
 * function follows its role again. A custom row is deleted only when its
 * model equals the role's model AND that model's default effort equals the
 * role's effort; every other custom row is listed with a reason and kept.
 * Non-custom rows are never touched.
 *
 * Usage (DATABASE_URL from .env.local; never printed):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/ai/cleanup-role-rows.ts --expect-db gc_curriculum [--apply]   # default: dry run
 *
 * Exit codes: 0 ok, 1 wrong DB, 2 usage, 4 apply failed.
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { aiFunctionSettings } from '@/lib/db/schema';
import { AI_FUNCTION_IDS, DEFAULT_ROLES, type AIFunctionId } from '@/lib/ai/function-settings';
import { DEFAULT_REASONING_EFFORT, ROLE_SETTINGS } from '@/lib/ai/models';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export interface CleanupPlan {
  delete: string[];
  keep: Array<{ functionId: string; reason: string }>;
}

export async function planCleanup(ex: Executor): Promise<CleanupPlan> {
  const rows = await ex.select({ functionId: aiFunctionSettings.functionId, customModel: aiFunctionSettings.customModel })
    .from(aiFunctionSettings)
    .where(eq(aiFunctionSettings.tier, 'custom'));
  const plan: CleanupPlan = { delete: [], keep: [] };
  for (const r of rows.sort((a, b) => a.functionId.localeCompare(b.functionId))) {
    if (!(AI_FUNCTION_IDS as readonly string[]).includes(r.functionId)) {
      plan.keep.push({ functionId: r.functionId, reason: 'unknown function id' });
      continue;
    }
    const role = ROLE_SETTINGS[DEFAULT_ROLES[r.functionId as AIFunctionId]];
    const model = r.customModel?.trim() ?? '';
    if (model !== role.model) {
      plan.keep.push({ functionId: r.functionId, reason: `pins ${model || '(none)'}; its role ${role.label} runs ${role.model}` });
    } else if (DEFAULT_REASONING_EFFORT[model] !== role.effort) {
      plan.keep.push({ functionId: r.functionId, reason: `effort ${DEFAULT_REASONING_EFFORT[model] ?? 'none'} differs from role ${role.label}'s ${role.effort ?? 'none'}` });
    } else {
      plan.delete.push(r.functionId);
    }
  }
  return plan;
}

export async function applyCleanup(ex: Executor, plan: CleanupPlan): Promise<void> {
  if (plan.delete.length === 0) return;
  await ex.delete(aiFunctionSettings).where(inArray(aiFunctionSettings.functionId, plan.delete));
}

export async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) { console.error('usage: --expect-db <name> [--apply]'); return 2; }
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }

  const plan = await planCleanup(db);
  for (const id of plan.delete) console.log(`delete  ${id} (follows its role ${ROLE_SETTINGS[DEFAULT_ROLES[id as AIFunctionId]].label} again)`);
  for (const k of plan.keep) console.log(`keep    ${k.functionId}: ${k.reason}`);
  if (!argv.includes('--apply')) {
    console.log(`DRY RUN: would delete ${plan.delete.length}, keep ${plan.keep.length} (nothing written).`);
    return 0;
  }
  try {
    await db.transaction(tx => applyCleanup(tx, plan));
  } catch (err) { console.error(formatDbError(err)); return 4; }
  console.log(`deleted ${plan.delete.length}, kept ${plan.keep.length}.`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
