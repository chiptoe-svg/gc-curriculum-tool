/**
 * One-shot seed script: reads CAREER_TARGETS constant and inserts into
 * career_targets, sub_competencies and career_target_requirements (migration
 * 0056; P0b migration 0057 lets one competency belong to several targets).
 *
 * Each catalog definition (a plain SubCompetency entry; a `{ ref }` entry
 * points at one defined elsewhere) is inserted into sub_competencies exactly
 * once, before any membership — a `{ ref }` entry would otherwise violate
 * the career_target_requirements FK if its target were seeded first. Then
 * every target's full entry list (definitions and refs alike, resolved to
 * ids) is inserted into career_target_requirements in list order. Unlike
 * the pre-P0b version, a competency used by more than one target is
 * expected and no longer guarded against.
 *
 * Uses ON CONFLICT DO NOTHING — idempotent, safe to re-run.
 * Run with: pnpm db:seed (requires DATABASE_URL in environment)
 *
 * Source .env.local first:
 *   set -a; source .env.local; set +a; pnpm db:seed
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { CAREER_TARGETS } from '../lib/domain/seed-targets';
import { competencyEntryId, isSubCompetencyDefinition } from '../lib/domain/types';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Source .env.local first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log(`Seeding ${CAREER_TARGETS.length} career targets...`);

  // Step 1: insert every career target (idempotent).
  for (let i = 0; i < CAREER_TARGETS.length; i++) {
    const t = CAREER_TARGETS[i]!;
    await db.execute(sql`
      INSERT INTO career_targets (
        id, name, short_definition, industry_contexts,
        know_descriptors, understand_descriptors, do_descriptors,
        defensibility_note, soc_code, display_order, updated_at
      ) VALUES (
        ${t.id},
        ${t.name},
        ${t.shortDefinition},
        ${JSON.stringify(t.industryContexts)}::jsonb,
        ${JSON.stringify(t.knowDescriptors)}::jsonb,
        ${JSON.stringify(t.understandDescriptors)}::jsonb,
        ${JSON.stringify(t.doDescriptors)}::jsonb,
        ${t.defensibilityNote},
        ${t.socCode ?? null},
        ${i},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `);
    console.log(`  [${i + 1}/${CAREER_TARGETS.length}] Inserted career target: ${t.id}`);
  }

  // Step 2: insert each catalog definition exactly once (P0b: a `{ ref }`
  // entry points at a definition owned by a different target, so every
  // definition across CAREER_TARGETS is collected first, de-duplicated by
  // id, and inserted before any membership row references it).
  const definitions = new Map<string, (typeof CAREER_TARGETS)[number]['subCompetencies'][number]>();
  for (const t of CAREER_TARGETS) {
    for (const entry of t.subCompetencies) {
      if (isSubCompetencyDefinition(entry) && !definitions.has(entry.id)) definitions.set(entry.id, entry);
    }
  }
  let n = 0;
  for (const sc of definitions.values()) {
    if (!isSubCompetencyDefinition(sc)) continue; // narrows for TS; always true here
    n++;
    await db.execute(sql`
      INSERT INTO sub_competencies (
        id, name,
        know_descriptor, understand_descriptor, do_descriptor,
        retired, updated_at
      ) VALUES (
        ${sc.id},
        ${sc.name},
        ${sc.knowDescriptor},
        ${sc.understandDescriptor},
        ${sc.doDescriptor},
        false,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `);
    console.log(`  [${n}/${definitions.size}] Inserted sub-competency: ${sc.id}`);
  }

  // Step 3: insert each target's membership rows, in list order. A `{ ref }`
  // entry resolves to the same competency id as its definition — sharing a
  // competency across targets is expected under P0b and no longer guarded
  // against (the old single-target guard is gone with it).
  for (const t of CAREER_TARGETS) {
    // M-5 (adversarial review): one transaction per target, so a crash
    // mid-target leaves no half-written requirement rows for it to self-heal
    // on re-run (the script is otherwise idempotent via ON CONFLICT DO NOTHING).
    await db.transaction(async (tx) => {
      for (let j = 0; j < t.subCompetencies.length; j++) {
        const competencyId = competencyEntryId(t.subCompetencies[j]!);
        await tx.execute(sql`
          INSERT INTO career_target_requirements (
            career_target_id, competency_id, horizon, weight, weight_source, status, display_order
          ) VALUES (
            ${t.id}, ${competencyId}, 'entry', NULL, 'faculty', 'draft', ${j}
          )
          ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING
        `);
      }
    });
    console.log(`  Inserted ${t.subCompetencies.length} requirement(s) for: ${t.id}`);
  }

  console.log('\nSeed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
