/**
 * One-shot seed script: reads CAREER_TARGETS constant and inserts into
 * career_targets and sub_competencies tables.
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

    // Insert career target (idempotent)
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

    // Insert sub-competencies for this target
    for (let j = 0; j < t.subCompetencies.length; j++) {
      const sc = t.subCompetencies[j]!;
      await db.execute(sql`
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
    }
  }

  console.log('\nSeed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
