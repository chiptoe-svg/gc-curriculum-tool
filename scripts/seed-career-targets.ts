/**
 * One-shot seed script: reads CAREER_TARGETS constant and inserts into
 * career_targets, sub_competencies and career_target_requirements (migration 0056).
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

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Source .env.local first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log(`Seeding ${CAREER_TARGETS.length} career targets...`);

  for (let i = 0; i < CAREER_TARGETS.length; i++) {
    const t = CAREER_TARGETS[i]!;

    // M-5 (adversarial review): one transaction per target, so a crash
    // mid-target leaves no half-written requirement rows for it to self-heal
    // on re-run (the script is otherwise idempotent via ON CONFLICT DO NOTHING).
    await db.transaction(async (tx) => {
      // Insert career target (idempotent)
      await tx.execute(sql`
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

      // Insert sub-competencies for this target
      for (let j = 0; j < t.subCompetencies.length; j++) {
        const sc = t.subCompetencies[j]!;
        await tx.execute(sql`
          INSERT INTO sub_competencies (
            id, career_target_id, name,
            know_descriptor, understand_descriptor, do_descriptor,
            display_order, retired, updated_at
          ) VALUES (
            ${sc.id},
            ${t.id},
            ${sc.name},
            ${sc.knowDescriptor},
            ${sc.understandDescriptor},
            ${sc.doDescriptor},
            ${j},
            false,
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `);
        console.log(`    [${j + 1}/${t.subCompetencies.length}] Inserted sub-competency: ${sc.id}`);

        // M-5 (adversarial review, round 1): only add the requirement if no
        // OTHER target already claims this sub-competency — if
        // CAREER_TARGETS ever lists an existing id under a different
        // target, the old (pre-0056) seed silently did nothing for the
        // conflicting career_targets/sub_competencies rows, so the
        // requirement must not silently put the competency in a second
        // target either (the view would then show it in both, and the
        // rollback would refuse).
        //
        // M-c (round 2): this guard used to read the deprecated
        // sub_competencies.career_target_id mirror via raw SQL — a real but
        // easily-missed read of a column the project otherwise treats as
        // write-only, and a case the P0a raw-SQL guard (tests/db/p0a-guards
        // .test.ts) needed a whole-file exclusion to tolerate. Checking
        // career_target_requirements instead (the table that's actually
        // authoritative for membership, and the one P0b keeps once the
        // mirror is dropped) gives the identical guarantee without reading
        // the mirror at all: NOT EXISTS a requirement row for this
        // competency under any OTHER target. For a brand-new competency (no
        // requirement row yet, under any target) the NOT EXISTS is
        // vacuously true, so first-time seeding is unaffected; for a
        // competency already claimed by a different target, the NOT EXISTS
        // finds that row and blocks the insert, exactly as before.
        await tx.execute(sql`
          INSERT INTO career_target_requirements (
            career_target_id, competency_id, horizon, weight, weight_source, status, display_order
          )
          SELECT ${t.id}, ${sc.id}, 'entry', NULL, 'faculty', 'draft', ${j}
          WHERE NOT EXISTS (
            SELECT 1 FROM career_target_requirements
            WHERE competency_id = ${sc.id} AND career_target_id <> ${t.id}
          )
          ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING
        `);
      }
    });
  }

  console.log('\nSeed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
