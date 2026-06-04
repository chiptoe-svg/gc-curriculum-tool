/**
 * Build 0 — Catalog Import
 *
 * Seeds the courses table from the Clemson BS in GC degree plan:
 * https://catalog.clemson.edu/preview_program.php?catoid=49&poid=16765&returnto=1996
 *
 * Covers all 120 credit hours: GC Core, Gen Ed, Non-GC Required,
 * and every option within each Constrained Choice slot.
 * Specialty Area courses are not seeded here — too many departments
 * to enumerate; add them individually through the tool UI.
 *
 * Idempotent: ON CONFLICT (code) DO NOTHING — safe to re-run.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   pnpm db:seed-courses
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Source .env.local first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

interface CourseSeed {
  code: string;
  title: string;
  creditHours: number;
  level: 1 | 2 | 3 | 4;
  track: string;
  description: string;
}

// ── GC Core — all required GC-prefix courses ─────────────────────────────────

const GC_CORE: CourseSeed[] = [
  {
    code: 'GC 1010',
    title: 'Orientation to Graphic Communications',
    creditHours: 1,
    level: 1,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 1020',
    title: 'Introduction to Digital Graphics',
    creditHours: 2,
    level: 1,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 1040',
    title: 'Graphic Communications I',
    creditHours: 4,
    level: 1,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 1050',
    title: 'Application of Digital Graphics',
    creditHours: 2,
    level: 1,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 2070',
    title: 'Graphic Communications II',
    creditHours: 4,
    level: 2,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 2400',
    title: 'Introduction to Web Design and Development',
    creditHours: 3,
    level: 2,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 3400',
    title: 'Digital Imaging',
    creditHours: 4,
    level: 3,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 3460',
    title: 'Ink and Substrates',
    creditHours: 3,
    level: 3,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 3500',
    title: 'Graphic Communications Internship I',
    creditHours: 1,
    level: 3,
    track: 'GC Core',
    description: 'Minimum 12-week summer internship.',
  },
  {
    code: 'GC 3620',
    title: 'Brand Design',
    creditHours: 3,
    level: 3,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 3700',
    title: 'Introduction to Brand Communications',
    creditHours: 3,
    level: 3,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 3800',
    title: 'Junior Seminar in Graphic Communications',
    creditHours: 1,
    level: 3,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 4060',
    title: 'Package and Specialty Printing',
    creditHours: 4,
    level: 4,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 4400',
    title: 'Commercial Printing',
    creditHours: 4,
    level: 4,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 4440',
    title: 'Current Developments and Trends in Graphic Communications',
    creditHours: 4,
    level: 4,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 4480',
    title: 'Planning and Controlling Printing Functions',
    creditHours: 3,
    level: 4,
    track: 'GC Core',
    description: '',
  },
  {
    code: 'GC 4500',
    title: 'Graphic Communications Internship II',
    creditHours: 1,
    level: 4,
    track: 'GC Core',
    description: 'Minimum 12-week summer internship.',
  },
  {
    code: 'GC 4800',
    title: 'Senior Seminar in Graphic Communications',
    creditHours: 1,
    level: 4,
    track: 'GC Core',
    description: '',
  },
];

// ── Gen Ed — university general education requirements ────────────────────────

const GEN_ED: CourseSeed[] = [
  {
    code: 'ENGL 1030',
    title: 'Composition and Rhetoric',
    creditHours: 3,
    level: 1,
    track: 'Gen Ed',
    description: '',
  },
  {
    code: 'ENSP 2000',
    title: 'Introduction to Environmental Science',
    creditHours: 3,
    level: 2,
    track: 'Gen Ed',
    description: 'Satisfies science Gen Ed requirement.',
  },
  {
    code: 'PSYC 2010',
    title: 'Introduction to Psychology',
    creditHours: 3,
    level: 2,
    track: 'Gen Ed',
    description: 'Satisfies social science Gen Ed requirement. Directly develops consumer psychology foundation relevant to Brand Strategy and Account Management.',
  },
];

// ── Non-GC Required — required non-GC courses outside gen ed ─────────────────

const NON_GC_REQUIRED: CourseSeed[] = [
  {
    code: 'ACCT 2010',
    title: 'Financial Accounting Concepts',
    creditHours: 3,
    level: 2,
    track: 'Non-GC Required',
    description: '',
  },
  {
    code: 'ACCT 2020',
    title: 'Managerial Accounting Concepts',
    creditHours: 3,
    level: 2,
    track: 'Non-GC Required',
    description: '',
  },
  {
    code: 'MGT 2010',
    title: 'Principles of Management',
    creditHours: 3,
    level: 2,
    track: 'Non-GC Required',
    description: '',
  },
  {
    code: 'PKSC 1020',
    title: 'Introduction to Packaging Science',
    creditHours: 2,
    level: 1,
    track: 'Non-GC Required',
    description: 'Scaffolds production literacy that upper-division GC courses expect.',
  },
  {
    code: 'MKT 3010',
    title: 'Principles of Marketing',
    creditHours: 3,
    level: 3,
    track: 'Non-GC Required',
    description: '',
  },
];

// ── Constrained Choices — each option in each slot gets its own row ───────────
// The constraint model groups these by slot; each code is a distinct course.

const CONSTRAINED_CHOICES: CourseSeed[] = [
  // Statistics slot — choose one of four
  {
    code: 'STAT 2220',
    title: 'Statistics in Everyday Life',
    creditHours: 3,
    level: 2,
    track: 'Constrained Choice',
    description: 'Statistics slot option. Introductory — reaches Know level on quantitative reasoning.',
  },
  {
    code: 'STAT 2300',
    title: 'Statistical Methods I',
    creditHours: 3,
    level: 2,
    track: 'Constrained Choice',
    description: 'Statistics slot option.',
  },
  {
    code: 'STAT 3090',
    title: 'Biostatistics',
    creditHours: 3,
    level: 3,
    track: 'Constrained Choice',
    description: 'Statistics slot option. Develops quantitative analysis at Understand/Do level — substantially stronger for Brand Strategy and AI Workflow targets.',
  },
  {
    code: 'STAT 3300',
    title: 'Statistical Methods for Research',
    creditHours: 3,
    level: 3,
    track: 'Constrained Choice',
    description: 'Statistics slot option.',
  },

  // Economics slot — choose one of two
  {
    code: 'ECON 2000',
    title: 'Introduction to Economics: Microeconomics',
    creditHours: 3,
    level: 2,
    track: 'Constrained Choice',
    description: 'Economics slot option.',
  },
  {
    code: 'ECON 2110',
    title: 'Introduction to Economics: Macroeconomics',
    creditHours: 3,
    level: 2,
    track: 'Constrained Choice',
    description: 'Economics slot option. Stronger for Account Management — builds business-environment framing at Understand level.',
  },

  // Business/Professional Communication slot — choose one of two
  {
    code: 'PCID 3040',
    title: 'Business and Professional Communication',
    creditHours: 3,
    level: 3,
    track: 'Constrained Choice',
    description: 'Communication slot option.',
  },
  {
    code: 'PCID 3140',
    title: 'Information Design',
    creditHours: 3,
    level: 3,
    track: 'Constrained Choice',
    description: 'Communication slot option. Stronger for Brand Strategy and Creative Generalist — builds client presentation capability.',
  },
];

// ── All courses ───────────────────────────────────────────────────────────────

const ALL_COURSES: CourseSeed[] = [
  ...GC_CORE,
  ...GEN_ED,
  ...NON_GC_REQUIRED,
  ...CONSTRAINED_CHOICES,
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Seeding ${ALL_COURSES.length} courses from BS in GC catalog...\n`);

  const byTrack = new Map<string, number>();
  let inserted = 0;
  let skipped = 0;

  for (const c of ALL_COURSES) {
    const result = await db.execute(sql`
      INSERT INTO courses (
        code, title, level, track, description,
        prerequisites, learning_objectives, major_projects,
        skills_required, last_synced_at
      ) VALUES (
        ${c.code},
        ${c.title},
        ${c.level},
        ${c.track},
        ${c.description},
        '',
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        NOW()
      )
      ON CONFLICT (code) DO NOTHING
      RETURNING code
    `);

    const wasInserted = result.rows.length > 0;
    if (wasInserted) {
      inserted++;
      byTrack.set(c.track, (byTrack.get(c.track) ?? 0) + 1);
      console.log(`  ✓ ${c.code.padEnd(12)} ${c.title}`);
    } else {
      skipped++;
      console.log(`  — ${c.code.padEnd(12)} already exists, skipped`);
    }
  }

  console.log('\n── Summary ──────────────────────────────────────────');
  for (const [track, count] of Array.from(byTrack.entries()).sort()) {
    console.log(`  ${track.padEnd(22)} ${count} inserted`);
  }
  console.log(`\n  Total inserted: ${inserted}  |  Already existed: ${skipped}`);
  console.log('\nBuild 0 complete. Specialty Area courses can be added via the tool UI.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
