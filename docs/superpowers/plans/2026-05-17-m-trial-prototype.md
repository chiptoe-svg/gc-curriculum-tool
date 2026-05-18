# M-trial Faculty-Facing Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web tool deployed to Vercel where faculty paste two course syllabi and pick a career target, then see AI-drafted KUD outcomes for both courses, coverage scores against the chosen target's sub-competencies (with visible reasoning), and a prerequisite gap analysis identifying competencies the downstream course expects but no upstream course develops. Faculty can flag any AI reasoning they disagree with; flags persist for prompt tuning.

**Architecture:** Next.js 15 App Router single deployable. One public page at an unguessable slug (`/preview/[slug]`) with intro + instructions + form + output. One main API route (`POST /api/analyze`) that orchestrates four sequential AI calls behind a thin provider abstraction. One flag endpoint (`POST /api/flag`). Manning-skill-encoded prompts live in version-controlled markdown files under `lib/ai/prompts/`. Neon Postgres via Drizzle persists run logs and faculty flags. ~80% of the code (provider, prompts, seed data, heat map and gap components, JSON schemas) carries forward into M0–M3.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS, shadcn/ui, Drizzle ORM, Neon serverless Postgres, OpenAI SDK (default provider; Anthropic ready for swap), Zod for schemas, Vitest + Testing Library for tests, Vercel deployment.

---

## File Structure

```
gc-curriculum-tool/
├── app/
│   ├── layout.tsx                                 Root layout, fonts, global styles
│   ├── page.tsx                                   Landing page → redirects/links to /preview/[slug]
│   ├── globals.css                                Tailwind + base styles
│   ├── preview/
│   │   └── [slug]/
│   │       └── page.tsx                           The prototype page (intro/instructions/form/output)
│   └── api/
│       ├── analyze/route.ts                       POST: orchestrates 4 AI calls
│       ├── flag/route.ts                          POST: save a faculty flag
│       └── health/route.ts                        GET: provider name + DB version
├── components/
│   ├── ui/                                        shadcn/ui primitives (Button, Card, Textarea, Select, Dialog)
│   ├── PrototypeForm.tsx                          The 2-syllabus + dropdown + analyze form
│   ├── SampleSyllabusButton.tsx                   "Load GC 3460 example" buttons
│   ├── KUDCard.tsx                                Display one course's drafted KUD outcomes
│   ├── CoverageHeatMap.tsx                        2-row × N-column color-coded grid
│   ├── PrerequisiteGapPanel.tsx                   Gap list with status pills
│   ├── ReasoningExpand.tsx                        Click-to-expand reasoning + flag UI
│   └── FlagDialog.tsx                             Modal: enter flag note + submit
├── lib/
│   ├── ai/
│   │   ├── provider.ts                            AIProvider interface + factory
│   │   ├── openai.ts                              OpenAIProvider implementation
│   │   ├── prompts/
│   │   │   ├── load.ts                            Loads + composes markdown prompts at runtime
│   │   │   ├── draft-outcomes.md                  Manning: Backwards Design + KUD + Threshold Concept
│   │   │   ├── score-coverage.md                  Manning: Coverage Audit + KUD + Assessment Validity + Dev Band + Disciplinary AI
│   │   │   ├── suggest-prerequisites.md           Manning: Learning Progressions + Scope/Sequence + Backwards Design
│   │   │   ├── analyze-prerequisite-gaps.md       Manning: Learning Progressions + Scope/Sequence + Dev Band
│   │   │   └── shared/
│   │   │       ├── kud-rubric.md                  KUD scoring rubric (know/understand/do/not_addressed)
│   │   │       └── career-target-frame.md         How to reason about target sub-competencies
│   │   └── schemas.ts                             Zod schemas for the four AI outputs
│   ├── domain/
│   │   ├── types.ts                               CareerTarget, SubCompetency, AnalysisResult, etc.
│   │   ├── seed-targets.ts                        The 5 career targets + sub-competencies (hardcoded)
│   │   └── sample-syllabi.ts                      Pre-loaded syllabus text for 6 GC courses
│   ├── db/
│   │   ├── schema.ts                              Drizzle: prototype_runs, prototype_flags
│   │   ├── client.ts                              Neon HTTP client
│   │   └── queries.ts                             insertRun, insertFlag, listFlags
│   ├── rate-limit/
│   │   ├── ip-rate-limit.ts                       Per-IP 10/hour limiter (in-memory + DB fallback)
│   │   └── daily-cap.ts                           Daily $5 cost cap with email alert
│   └── slug.ts                                    Unguessable URL slug (env-driven)
├── drizzle/                                       Generated migration SQL
├── tests/
│   ├── lib/ai/openai.test.ts                      OpenAIProvider with mocked SDK
│   ├── lib/ai/schemas.test.ts                     Zod schema validation
│   ├── lib/db/queries.test.ts                     DB integration (insertRun/insertFlag)
│   ├── lib/rate-limit/ip-rate-limit.test.ts       Rate limit triggers at 11th request
│   └── api/analyze.test.ts                        End-to-end with FakeProvider
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── components.json                                shadcn/ui config
├── package.json
├── .env.example
└── .gitignore                                     (already exists; extend with Next.js entries)
```

---

## Task 0: Bootstrap project workspace

**Files:**
- Modify: `.gitignore` (extend with Next.js + Drizzle + test entries)
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`

- [ ] **Step 1: Verify Node version**

Run: `node --version`
Expected: `v20.x` or higher. If lower, abort and install Node 20+ via `nvm install 20`.

- [ ] **Step 2: Scaffold Next.js 15 in place (non-destructive)**

Run from the repo root (`/Users/admin/projects/curriculum_developer`):
```bash
npx --yes create-next-app@15 . \
  --typescript --tailwind --eslint --app \
  --src-dir false --import-alias "@/*" \
  --turbopack --use-pnpm \
  --skip-install
```

When prompted to overwrite existing files (README.md, .gitignore), answer **No**. The scaffold should add `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/favicon.ico`, `next-env.d.ts`.

Expected files after: `app/page.tsx` exists with default Next.js content.

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
pnpm add drizzle-orm @neondatabase/serverless openai zod
pnpm add -D drizzle-kit vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom @types/node
```

Expected: `node_modules/` populated, no errors. `package.json` updated with all deps.

- [ ] **Step 4: Update .gitignore**

Replace the existing `.gitignore` with:
```
# Node / Next.js
node_modules/
.next/
out/
build/
dist/
*.tsbuildinfo
next-env.d.ts

# Environment
.env
.env.local
.env.*.local
!.env.example

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.pnpm-store/

# Editor
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test / coverage
coverage/
.nyc_output/

# Drizzle generated
drizzle/meta/

# Local data
*.local.json
/tmp/
/scratch/
```

- [ ] **Step 5: Configure strict TypeScript**

Edit `tsconfig.json` and set under `compilerOptions`:
```json
"strict": true,
"noUncheckedIndexedAccess": true,
"forceConsistentCasingInFileNames": true,
"target": "ES2022"
```
Keep all existing keys; only add/change the four above.

- [ ] **Step 6: Smoke test dev server**

Run: `pnpm dev`
Expected: Server starts at `http://localhost:3000` and shows the default Next.js page. Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: bootstrap Next.js 15 + TypeScript + Tailwind workspace"
```

---

## Task 1: Configure Vitest

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/smoke.test.ts`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Write failing smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Create Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './') },
  },
});
```

Create `tests/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Add test script**

In `package.json`, under `scripts`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Run the test**

Run: `pnpm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/setup.ts tests/smoke.test.ts package.json
git commit -m "test: configure Vitest with jsdom environment"
```

---

## Task 2: Set up Neon Postgres + Drizzle

**Files:**
- Create: `drizzle.config.ts`, `lib/db/client.ts`, `lib/db/schema.ts`, `.env.example`
- Modify: `package.json` (add db scripts)

- [ ] **Step 1: Create Neon project (manual)**

Open https://console.neon.tech, create a new project called `gc-curriculum-tool`. Copy the connection string (it looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`).

- [ ] **Step 2: Create .env.example and .env.local**

Create `.env.example`:
```
# Neon Postgres (pooled connection from project dashboard)
DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# AI provider — 'openai' (default) or 'anthropic'
AI_PROVIDER=openai

# Anthropic (optional, only if switching)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

# Unguessable URL slug for the prototype
PROTOTYPE_SLUG=preview-abc123def456

# Cost protection
DAILY_COST_CAP_USD=5
COST_ALERT_EMAIL=chiptoe@mac.com
```

Create `.env.local` (gitignored already) with the actual values you have available right now. If you don't have an OpenAI key yet, leave it blank — Task 7's tests can still run with a fake provider.

- [ ] **Step 3: Drizzle config**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 4: Client**

Create `lib/db/client.ts`:
```ts
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

neonConfig.fetchConnectionCache = true;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

export const db = drizzle(neon(process.env.DATABASE_URL), { schema });
```

- [ ] **Step 5: Schema (prototype_runs + prototype_flags)**

Create `lib/db/schema.ts`:
```ts
import { pgTable, uuid, text, jsonb, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const prototypeRuns = pgTable('prototype_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),                 // SHA-256(ip) — never store raw IP
  careerTargetId: text('career_target_id').notNull(),
  upstreamCourseLabel: text('upstream_course_label'),     // optional faculty-supplied
  downstreamCourseLabel: text('downstream_course_label'),
  upstreamSyllabus: text('upstream_syllabus').notNull(),
  downstreamSyllabus: text('downstream_syllabus').notNull(),
  result: jsonb('result').notNull(),                 // the full AnalysisResult object
  aiProvider: text('ai_provider').notNull(),
  aiModel: text('ai_model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(), // estimated cost in 1/100 of a cent
  durationMs: integer('duration_ms').notNull(),
});

export const prototypeFlags = pgTable('prototype_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  runId: uuid('run_id').notNull().references(() => prototypeRuns.id, { onDelete: 'cascade' }),
  flagType: text('flag_type').notNull(),             // 'coverage' | 'prerequisite_gap' | 'kud_draft'
  target: text('target').notNull(),                  // e.g., "upstream.sub_comp_id" or "gap.id"
  note: text('note').notNull(),
  resolved: boolean('resolved').default(false).notNull(),
});
```

- [ ] **Step 6: Generate and run the migration**

Run:
```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```
Expected: A SQL file appears under `drizzle/`; running migrate creates both tables on Neon.

Verify in Neon console: tables `prototype_runs` and `prototype_flags` exist.

- [ ] **Step 7: Add db scripts**

In `package.json` `scripts`:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 8: Commit**

```bash
git add drizzle.config.ts drizzle/ lib/db/ .env.example package.json
git commit -m "feat: add Neon + Drizzle with prototype_runs and prototype_flags schema"
```

---

## Task 3: Define domain types

**Files:**
- Create: `lib/domain/types.ts`

- [ ] **Step 1: Create the type module**

Create `lib/domain/types.ts`:
```ts
// Career target definition (hardcoded for M-trial; becomes DB row in M1)
export type KUDLevel = 'know' | 'understand' | 'do' | 'not_addressed';
export type Confidence = 'high' | 'medium' | 'low';
export type GapStatus = 'met' | 'underdeveloped' | 'missing';

export interface SubCompetency {
  id: string;                  // stable slug like "brand-positioning"
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
}

export interface CareerTarget {
  id: string;                  // "account-management" | "brand-strategy" | ...
  name: string;
  shortDefinition: string;
  industryContexts: string[];
  knowDescriptors: string[];
  understandDescriptors: string[];
  doDescriptors: string[];
  defensibilityNote: string;
  socCode: string | null;      // SOC code if anchored to O*NET
  subCompetencies: SubCompetency[];
}

// AI output shapes
export interface KUDOutcomes {
  description: string;
  know: string[];
  understand: string[];
  do: string[];
}

export interface CoverageScore {
  subCompetencyId: string;
  kudLevel: KUDLevel;
  confidence: Confidence;
  reasoning: string;
}

export interface PrerequisiteCompetencyClaim {
  subCompetencyId: string;
  expectedKudLevel: Exclude<KUDLevel, 'not_addressed'>;
  rationale: string;
}

export interface PrerequisiteGap {
  subCompetencyId: string;
  expectedKudLevel: Exclude<KUDLevel, 'not_addressed'>;
  status: GapStatus;
  upstreamEvidence: string;    // human-readable description of what upstream actually develops
  reasoning: string;
}

// The full result returned from /api/analyze
export interface AnalysisResult {
  upstream: { kud: KUDOutcomes; coverage: CoverageScore[] };
  downstream: {
    kud: KUDOutcomes;
    coverage: CoverageScore[];
    prerequisiteCompetencies: PrerequisiteCompetencyClaim[];
    prerequisiteGaps: PrerequisiteGap[];
  };
  careerTargetId: string;
  meta: {
    aiProvider: string;
    aiModel: string;
    durationMs: number;
    costUsdCents: number;
  };
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/domain/types.ts
git commit -m "feat: define domain types for analysis result and career targets"
```

---

## Task 4: Seed the 5 career targets

**Files:**
- Create: `lib/domain/seed-targets.ts`
- Create: `tests/lib/domain/seed-targets.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/domain/seed-targets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CAREER_TARGETS, getTargetById } from '@/lib/domain/seed-targets';

describe('seed-targets', () => {
  it('exposes all 5 career targets', () => {
    expect(CAREER_TARGETS).toHaveLength(5);
    const ids = CAREER_TARGETS.map(t => t.id);
    expect(ids).toEqual([
      'account-management',
      'brand-strategy',
      'production-operations',
      'creative-generalist',
      'ai-workflow',
    ]);
  });

  it('every target has at least 5 sub-competencies', () => {
    for (const t of CAREER_TARGETS) {
      expect(t.subCompetencies.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('getTargetById returns the target', () => {
    expect(getTargetById('brand-strategy')?.name).toBe('Brand Strategy');
  });

  it('every sub-competency has unique id within its target', () => {
    for (const t of CAREER_TARGETS) {
      const ids = t.subCompetencies.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

Run: `pnpm test seed-targets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement seed data**

Create `lib/domain/seed-targets.ts`. The content below is the full required data, sourced from the v1 design doc and the source spec's "Career Target Framework — Preliminary Definitions" section.

```ts
import type { CareerTarget } from './types';

export const CAREER_TARGETS: CareerTarget[] = [
  {
    id: 'account-management',
    name: 'Account Management',
    shortDefinition:
      'The consultative client-facing role that bridges a brand\'s marketing intent and the production or creative execution required to realize it.',
    industryContexts: [
      'Agency account team serving brand clients across print and digital deliverables',
      'In-house brand marketing coordinator translating creative briefs to vendors',
      'Print/packaging sales representative consulting on production specifications',
    ],
    knowDescriptors: [
      'How print and packaging production processes work',
      'What brand standards govern visual consistency',
      'How agency and client organizations are structured',
    ],
    understandDescriptors: [
      'Why client relationships require ongoing trust investment',
      'Why production constraints shape creative possibility',
      'Why the account manager\'s credibility depends on domain knowledge',
    ],
    doDescriptors: [
      'Manage a client relationship through a full project cycle',
      'Translate a brand brief into a production specification',
      'Present results in terms that matter to the client',
    ],
    defensibilityNote:
      'Trust, relationship continuity, and organizational navigation are not automatable. Understanding what a client actually needs (as opposed to what they asked for) requires human judgment and accumulated context that AI cannot replicate.',
    socCode: '41-4012.00',
    subCompetencies: [
      {
        id: 'client-needs-diagnosis',
        name: 'Client needs diagnosis',
        knowDescriptor: 'Knows how to ask questions that surface unstated client needs and how to read project briefs critically.',
        understandDescriptor: 'Understands why stated needs often diverge from underlying business problems and how to navigate that gap.',
        doDescriptor: 'Conducts a discovery conversation that produces a written needs assessment distinct from the original brief.',
      },
      {
        id: 'proposal-development',
        name: 'Proposal development and consultative communication',
        knowDescriptor: 'Knows the structural elements of a client proposal and the rhythm of consultative communication.',
        understandDescriptor: 'Understands why a proposal must justify scope, sequence, and cost in business terms — not creative terms.',
        doDescriptor: 'Writes and presents a proposal that wins client commitment and sets accurate expectations for delivery.',
      },
      {
        id: 'project-oversight',
        name: 'Project oversight across creative and production workflows',
        knowDescriptor: 'Knows the standard handoff points between brief, creative, prepress, production, and delivery.',
        understandDescriptor: 'Understands why timeline and quality trade-offs are continuous decisions, not one-time choices.',
        doDescriptor: 'Manages a project through its full cycle while keeping client, creative, and production teams aligned.',
      },
      {
        id: 'results-interpretation',
        name: 'Results interpretation and client reporting',
        knowDescriptor: 'Knows the metrics that matter to brand and production clients.',
        understandDescriptor: 'Understands why client reporting frames results in business outcomes, not deliverable counts.',
        doDescriptor: 'Produces a post-project report a client uses to justify continued investment.',
      },
      {
        id: 'gc-production-literacy',
        name: 'Domain literacy in print, packaging, and brand production',
        knowDescriptor: 'Knows what print, packaging, and brand production processes can and cannot accommodate.',
        understandDescriptor: 'Understands why this knowledge is what differentiates a credible account manager from an order-taker.',
        doDescriptor: 'Holds a substantive conversation with a brand director and turns to brief a production team accurately.',
      },
    ],
  },
  {
    id: 'brand-strategy',
    name: 'Brand Strategy',
    shortDefinition:
      'The analytical and strategic layer of marketing — understanding consumers, competitors, and market conditions well enough to define where a brand should position itself and how.',
    industryContexts: [
      'Brand strategist at an agency producing positioning recommendations',
      'In-house brand manager defining campaign objectives and measurement frameworks',
      'Insights analyst translating research into strategic direction',
    ],
    knowDescriptors: [
      'Research methodologies (qualitative and quantitative)',
      'Brand architecture frameworks',
      'Competitive analysis tools',
      'Statistical concepts',
    ],
    understandDescriptors: [
      'Why consumer behavior is contextual and not fully predictable',
      'Why brand positioning requires trade-offs',
      'Why measurement frameworks must align with business objectives',
    ],
    doDescriptors: [
      'Design and execute a consumer research study',
      'Synthesize findings into a strategic recommendation',
      'Evaluate campaign performance against defined objectives',
    ],
    defensibilityNote:
      'AI can process consumer data but cannot make judgment calls about brand voice, cultural resonance, or when a data signal is meaningful versus misleading. Brand strategy requires weighing ambiguous information against business context — which requires human judgment.',
    socCode: '13-1161.00',
    subCompetencies: [
      {
        id: 'consumer-research',
        name: 'Consumer research and insight synthesis',
        knowDescriptor: 'Knows the major qualitative and quantitative research methods and when each is appropriate.',
        understandDescriptor: 'Understands why insight synthesis is interpretive work that requires more than reporting findings.',
        doDescriptor: 'Designs and executes a consumer research study and synthesizes findings into a strategic insight.',
      },
      {
        id: 'competitive-analysis',
        name: 'Competitive and market analysis',
        knowDescriptor: 'Knows competitive analysis frameworks and where to source competitor data.',
        understandDescriptor: 'Understands why competitive context shapes what brand positioning is possible.',
        doDescriptor: 'Produces a competitive analysis that informs a positioning recommendation.',
      },
      {
        id: 'brand-positioning',
        name: 'Brand positioning and messaging strategy',
        knowDescriptor: 'Knows brand architecture frameworks and positioning models.',
        understandDescriptor: 'Understands why positioning requires trade-offs and why a brand cannot stand for everything.',
        doDescriptor: 'Develops a brand positioning recommendation grounded in evidence about consumer and market context.',
      },
      {
        id: 'campaign-measurement',
        name: 'Campaign planning and effectiveness measurement',
        knowDescriptor: 'Knows how campaign measurement frameworks are designed.',
        understandDescriptor: 'Understands why measurement must connect to business objectives, not deliverable activity.',
        doDescriptor: 'Designs a measurement framework for a campaign and evaluates results against objectives.',
      },
      {
        id: 'quantitative-literacy',
        name: 'Quantitative literacy',
        knowDescriptor: 'Knows basic statistical concepts and how to read research outputs critically.',
        understandDescriptor: 'Understands why statistical significance is not the same as practical significance.',
        doDescriptor: 'Interprets research data, identifies signal vs. noise, and translates findings into recommendations.',
      },
      {
        id: 'cross-channel-translation',
        name: 'Cross-channel brand translation (print, packaging, digital)',
        knowDescriptor: 'Knows how a brand standard manifests differently across digital and physical channels.',
        understandDescriptor: 'Understands why cross-channel consistency requires deliberate translation, not duplication.',
        doDescriptor: 'Translates a single brand positioning into coherent execution across print, packaging, and digital.',
      },
    ],
  },
  {
    id: 'production-operations',
    name: 'Production & Operations',
    shortDefinition:
      'The role that makes creative and brand work actually happen — on time, on spec, and within budget. Production managers design and oversee the workflows, quality systems, vendor relationships, and team coordination that translate a creative brief into a finished physical or digital product.',
    industryContexts: [
      'Production manager at a printer overseeing offset and digital press workflows',
      'In-house operations lead at a brand managing vendor selection and quality',
      'Packaging production specialist on a multi-vendor brand launch',
    ],
    knowDescriptors: [
      'Print and packaging production processes',
      'Quality standards and measurement tools',
      'Vendor capabilities and limitations',
      'Cost structures',
    ],
    understandDescriptors: [
      'Why quality failures happen and how to design systems that catch them earlier',
      'Why timeline management is a people problem as much as a scheduling problem',
      'Why vendor relationships require investment',
    ],
    doDescriptors: [
      'Design a production workflow for a complex multi-component brand project',
      'Evaluate a print proof against specification',
      'Manage a production schedule across multiple vendors under time pressure',
    ],
    defensibilityNote:
      'Production management requires real-time judgment in complex systems with human teams, physical constraints, and unexpected failures. AI can optimize known workflows, but it cannot manage a vendor relationship under pressure, make a quality judgment on a print proof, or navigate the human dynamics of a production floor.',
    socCode: '11-3051.00',
    subCompetencies: [
      {
        id: 'workflow-design',
        name: 'Production workflow design and optimization',
        knowDescriptor: 'Knows the standard workflow patterns for offset, digital, flexo, and packaging production.',
        understandDescriptor: 'Understands why workflow design must balance throughput, quality, and adaptability — and why optimizing one trades off another.',
        doDescriptor: 'Designs a production workflow for a multi-component project that meets quality, timeline, and budget constraints.',
      },
      {
        id: 'quality-control',
        name: 'Quality control systems and standards enforcement',
        knowDescriptor: 'Knows industry quality standards (G7, ISO 12647, FTA FIRST) and the instruments used to measure conformance.',
        understandDescriptor: 'Understands why quality failures cluster around handoff points and why systems must catch problems earlier than at final inspection.',
        doDescriptor: 'Sets up and operates a quality control system that prevents predictable failure modes for a specific production context.',
      },
      {
        id: 'vendor-management',
        name: 'Vendor selection, management, and relationship maintenance',
        knowDescriptor: 'Knows the capabilities and limitations of the major vendor categories in print and packaging.',
        understandDescriptor: 'Understands why vendor relationships are long-term investments and how trust shapes what vendors will and won\'t do under pressure.',
        doDescriptor: 'Selects, briefs, and manages a vendor through a complex project including specification, delivery, and post-project review.',
      },
      {
        id: 'timeline-management',
        name: 'Timeline management under constraint and pressure',
        knowDescriptor: 'Knows the typical lead-time structure for print and packaging production at varying complexity.',
        understandDescriptor: 'Understands why timeline slippage compounds and why early signals matter more than aggressive deadlines.',
        doDescriptor: 'Manages a production schedule across multiple vendors and surfaces timeline risk early enough to act.',
      },
      {
        id: 'cost-management',
        name: 'Cost estimation and budget management',
        knowDescriptor: 'Knows the cost structures of major print and packaging processes.',
        understandDescriptor: 'Understands why cost estimation requires reconciling specification, vendor capability, and run-length economics.',
        doDescriptor: 'Produces a defensible cost estimate for a complex production project and manages spend through to delivery.',
      },
      {
        id: 'team-coordination',
        name: 'Team coordination and performance management',
        knowDescriptor: 'Knows how production teams are structured and the typical responsibilities at each role.',
        understandDescriptor: 'Understands why coordination breaks down under stress and what practices preserve communication.',
        doDescriptor: 'Coordinates a production team through a high-pressure project and addresses performance gaps in real time.',
      },
      {
        id: 'domain-knowledge',
        name: 'Domain knowledge: substrates, color, materials',
        knowDescriptor: 'Knows the major substrate categories, color management systems, and materials used in print and packaging production.',
        understandDescriptor: 'Understands why substrate and ink interactions constrain creative possibility and how to advise designers accordingly.',
        doDescriptor: 'Makes substantive specification decisions on substrate, color, and finishing for a real production project.',
      },
    ],
  },
  {
    id: 'creative-generalist',
    name: 'Creative Generalist / AI-Native',
    shortDefinition:
      'A practitioner with broad creative capability across copy, design, photography, video, and print — who uses AI as a force multiplier that makes generalism viable at a professional level.',
    industryContexts: [
      'In-house creative at a small or mid-sized brand producing across all channels',
      'Independent creative producing brand-scale work with AI-augmented workflow',
      'Agency creative bridging copy, design, and motion under one role',
    ],
    knowDescriptors: [
      'How AI generative tools work and where they are reliable versus unreliable',
      'What brand standards govern visual and verbal output',
      'How print production constraints affect digital creative decisions',
    ],
    understandDescriptors: [
      'Why aesthetic judgment cannot be delegated to AI',
      'Why creative iteration requires a human who can evaluate outputs against a brief',
      'Why generalism supported by AI is a strategic position rather than a compromise',
    ],
    doDescriptors: [
      'Take a brand brief from concept through finished output across at least three media using AI-assisted workflow',
      'Evaluate AI-generated outputs against a brand standard and select, reject, or refine',
      'Document a creative workflow that others could replicate',
    ],
    defensibilityNote:
      'AI executes but cannot direct itself. Generative tools require a human who knows what good looks like, what the brand requires, and when an output serves the brief versus when it doesn\'t.',
    socCode: null,
    subCompetencies: [
      {
        id: 'conceptual-development',
        name: 'Conceptual development and creative ideation across disciplines',
        knowDescriptor: 'Knows ideation methods and how to translate a brief into a creative direction.',
        understandDescriptor: 'Understands why conceptual development requires constraint and how to use the brief as the discipline.',
        doDescriptor: 'Develops a creative concept that responds to a brief and translates across at least three executional media.',
      },
      {
        id: 'aesthetic-judgment',
        name: 'Aesthetic judgment and brand visual literacy',
        knowDescriptor: 'Knows the major design principles and how brand standards encode aesthetic decisions.',
        understandDescriptor: 'Understands why aesthetic judgment requires accumulated reference and cannot be reduced to a checklist.',
        doDescriptor: 'Evaluates a body of creative work against a brand standard and identifies what works, what doesn\'t, and why.',
      },
      {
        id: 'ai-tool-direction',
        name: 'AI tool direction: prompt design, iteration, quality evaluation',
        knowDescriptor: 'Knows the capabilities and failure modes of major generative AI tools across image, copy, and video.',
        understandDescriptor: 'Understands why AI outputs require iteration grounded in human judgment about what good looks like.',
        doDescriptor: 'Directs an AI workflow from prompt through final output that meets brand quality standards.',
      },
      {
        id: 'cross-medium-production',
        name: 'Cross-medium creative production (copy, design, image, video, print)',
        knowDescriptor: 'Knows the production constraints and standards across the major creative media.',
        understandDescriptor: 'Understands why generalism requires fluency across disciplines, not specialization in any one.',
        doDescriptor: 'Produces finished work across at least three creative media for a single brand project.',
      },
      {
        id: 'brand-standards-application',
        name: 'Brand standards interpretation and application',
        knowDescriptor: 'Knows the typical structure of brand standards documents and what they govern.',
        understandDescriptor: 'Understands why brand standards are guidelines that require interpretation, not rules that mechanically apply.',
        doDescriptor: 'Applies brand standards to a creative deliverable with appropriate judgment about edge cases.',
      },
      {
        id: 'brief-translation',
        name: 'Client brief translation into creative direction',
        knowDescriptor: 'Knows the standard structure of a creative brief and what information it should contain.',
        understandDescriptor: 'Understands why translating a brief into creative direction requires interrogating the brief, not just executing it.',
        doDescriptor: 'Translates a real brand brief into a creative direction that the brief author recognizes as substantively responsive.',
      },
    ],
  },
  {
    id: 'ai-workflow',
    name: 'AI Workflow / Orchestrator',
    shortDefinition:
      'The person who designs, builds, and manages the AI-augmented workflows that allow creative and production organizations to scale output without proportionally scaling headcount.',
    industryContexts: [
      'Workflow designer at an agency rolling out AI-assisted production',
      'Operations lead at a brand integrating AI tools into existing creative workflows',
      'Independent consultant building AI workflows for small creative shops',
    ],
    knowDescriptors: [
      'How major AI tools (generative image, copy, video, layout) work and where they fail',
      'What workflow design principles apply to creative production contexts',
      'How to document workflows so they can be maintained and improved',
    ],
    understandDescriptors: [
      'Why AI tool outputs require domain-expert evaluation',
      'Why workflow design is a continuous improvement process, not a one-time build',
      'Why change management is the hardest part of AI adoption',
    ],
    doDescriptors: [
      'Design and document an AI-augmented workflow for a specific creative or production context',
      'Evaluate the output of an AI-assisted workflow against a quality standard and identify where revision is needed',
      'Train a small team to operate a documented AI workflow',
    ],
    defensibilityNote:
      'This role requires both domain expertise and technical fluency — the combination is rare. An AI workflow designer who doesn\'t understand creative and production work will build workflows that produce technically correct but creatively wrong outputs.',
    socCode: null,
    subCompetencies: [
      {
        id: 'ai-tool-evaluation',
        name: 'AI tool evaluation: capabilities, limitations, and appropriate use cases',
        knowDescriptor: 'Knows the major categories of generative and analytical AI tools and their current capabilities.',
        understandDescriptor: 'Understands why tool selection must match the specific creative or production problem, and why default tool choices fail in specialized contexts.',
        doDescriptor: 'Evaluates a set of AI tools against a specific use case and recommends a stack with defensible rationale.',
      },
      {
        id: 'workflow-architecture',
        name: 'Workflow architecture: sequencing human and AI work',
        knowDescriptor: 'Knows workflow design patterns and the role of handoff points in maintaining quality.',
        understandDescriptor: 'Understands why workflows fail at handoff points and why sequencing matters more than tool choice.',
        doDescriptor: 'Designs a workflow for a real creative or production context that sequences human and AI work for both quality and efficiency.',
      },
      {
        id: 'prompt-design',
        name: 'Prompt design, testing, and documentation',
        knowDescriptor: 'Knows the principles of effective prompt design and how prompts behave across models.',
        understandDescriptor: 'Understands why prompts are versioned artifacts that require testing and maintenance, not one-time text.',
        doDescriptor: 'Writes, tests, and documents prompts that produce consistent outputs across a real production workflow.',
      },
      {
        id: 'quality-frameworks',
        name: 'Quality evaluation frameworks for AI output',
        knowDescriptor: 'Knows the dimensions on which AI output quality is evaluated in creative and production contexts.',
        understandDescriptor: 'Understands why quality evaluation requires domain expertise and cannot be fully automated.',
        doDescriptor: 'Builds a quality review process for an AI-assisted workflow that catches failure modes consistently.',
      },
      {
        id: 'change-management',
        name: 'Change management for AI workflow adoption',
        knowDescriptor: 'Knows the standard models of change management and the typical resistance patterns in creative teams.',
        understandDescriptor: 'Understands why adoption fails when the workflow is technically sound but socially unsupported.',
        doDescriptor: 'Manages a small team through adoption of a new AI workflow without losing output quality.',
      },
      {
        id: 'domain-grounding',
        name: 'Domain grounding: creative, brand, and production knowledge',
        knowDescriptor: 'Knows enough of the underlying creative and production domain to evaluate whether an AI output is fit for purpose.',
        understandDescriptor: 'Understands why domain ignorance produces workflows that look correct but fail at the point of use.',
        doDescriptor: 'Designs an AI workflow that reflects credible domain knowledge of the creative or production context it serves.',
      },
    ],
  },
];

export function getTargetById(id: string): CareerTarget | undefined {
  return CAREER_TARGETS.find(t => t.id === id);
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test seed-targets`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/seed-targets.ts tests/lib/domain/seed-targets.test.ts
git commit -m "feat: seed 5 career targets with sub-competencies and KUD descriptors"
```

---

## Task 5: Sample syllabi from source spec

**Files:**
- Create: `lib/domain/sample-syllabi.ts`
- Create: `tests/lib/domain/sample-syllabi.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/domain/sample-syllabi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SAMPLE_SYLLABI, getSampleByCode } from '@/lib/domain/sample-syllabi';

describe('sample-syllabi', () => {
  it('contains 6 syllabi for the documented courses', () => {
    expect(SAMPLE_SYLLABI).toHaveLength(6);
    const codes = SAMPLE_SYLLABI.map(s => s.courseCode);
    expect(codes).toEqual(['GC 3400', 'GC 3460', 'GC 3720', 'GC 4060', 'GC 4070', 'GC 4400']);
  });

  it('every sample has non-empty title, level, and syllabus text', () => {
    for (const s of SAMPLE_SYLLABI) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.level).toBeGreaterThanOrEqual(1);
      expect(s.level).toBeLessThanOrEqual(4);
      expect(s.syllabusText.length).toBeGreaterThan(100);
    }
  });

  it('getSampleByCode returns the right one', () => {
    expect(getSampleByCode('GC 3460')?.title).toContain('Ink and Substrates');
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

Run: `pnpm test sample-syllabi`
Expected: FAIL.

- [ ] **Step 3: Implement sample data**

Create `lib/domain/sample-syllabi.ts`. The content comes from the source spec's `gc-curriculum-tool-spec.md` lines 1086–1119:

```ts
export interface SampleSyllabus {
  courseCode: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  syllabusText: string;       // composed: learning objectives + projects + notes
}

export const SAMPLE_SYLLABI: SampleSyllabus[] = [
  {
    courseCode: 'GC 3400',
    title: 'Digital Imaging',
    level: 3,
    syllabusText: `GC 3400 — Digital Imaging (Level 3)

Learning Objectives:
- Digital asset management
- Image capture
- Lighting for products and people
- Ethics and copyright in digital imaging
- Video storytelling
- Short-format video production and editing
- Audio engineering

Projects:
- Photography units: digital asset management, camera settings, photojournalism, Photoshop for photographers, lighting, critique
- Video units: Premiere Pro, editing remix, audio engineering, interview podcast

Assessment context (from curriculum review): This is the clearest Creative Generalist course in the curriculum — photography, video, storytelling, and editing across media. Do-level creative generalist content.`,
  },
  {
    courseCode: 'GC 3460',
    title: 'Ink and Substrates',
    level: 3,
    syllabusText: `GC 3460 — Ink and Substrates (Level 3)

Learning Objectives:
- Ink and substrate manufacturing
- Physical and optical property testing and analysis
- Print metrics and process optimization
- Color theory and separation systems
- Quality control instrumentation
- Proofing systems

Projects:
- Brand Color Report (Pantone color reproduction analysis)
- Ink Formulation
- Substrate Properties Testing
- Ink Properties Testing and Lab Report

Assessment context (from curriculum review): Pure production science. No brand, creative, or management content. Do-level Production & Operations.`,
  },
  {
    courseCode: 'GC 3720',
    title: 'Digital Content & CMS',
    level: 3,
    syllabusText: `GC 3720 — Digital Content & CMS (Level 3, Brand Communications)

Learning Objectives:
- Goal-driven website development with CMS
- Brand-forward digital content creation
- Social marketing channel deployment
- Website conversion techniques
- Website goal measurement
- Presentation skills

Projects:
- Website Design & Development (WordPress)
- Client Research (competitive analysis)
- Website Strategy
- Content Strategy
- Final Presentation

Assessment context: Strongest Brand Strategy course in the curriculum with data. Client research, content strategy, measurement, and brand-forward execution — Do-level brand strategy content.`,
  },
  {
    courseCode: 'GC 4060',
    title: 'Package & Specialty Printing',
    level: 4,
    syllabusText: `GC 4060 — Package & Specialty Printing (Level 4)

Learning Objectives:
- Specialty and package printing processes
- Package design requirements (technical and economic)
- Flexographic workflow
- Prepress functions
- Folding carton and corrugated package design
- Ink/substrate relationship in packaging
- Color correction
- Print quality analysis

Projects:
- Skill-building assignments across specialty printing
- 3-Color Spot Functional Label
- 4-Color and Cold Foil Promotional Label
- Paperboard Project
- Specialty Printing Pieces

Assessment context: Do-level Production & Operations with packaging specialization. One of the strongest technical production courses in the program.`,
  },
  {
    courseCode: 'GC 4070',
    title: 'Advanced Flexography',
    level: 4,
    syllabusText: `GC 4070 — Advanced Flexography (Level 4)

Learning Objectives:
- FTA FIRST certification (Level 1)
- Test target creation
- Bump curves and press curve analysis
- Automated prepress workflows (RIP configurations, trapping, quality control)
- Color management with GMG OpenColor and ICC profiles
- Complex flexographic print jobs with multi-color, coatings, and specialty effects

Projects:
- FIRST Operator Certification
- Test Target Creation
- Plate/Press/PressSync Curve Creation
- Workflow Automation Tickets
- Color Management & Proofing
- Industry Engagement
- Capstone: Press Matching with Custom Profiles

Assessment context: Do-level Production & Operations. The "Workflow Automation: Tickets" project is the only existing course content that touches AI Workflow territory — automated prepress workflow design is a precursor skill. Understand-level AI Workflow.`,
  },
  {
    courseCode: 'GC 4400',
    title: 'Commercial Printing',
    level: 4,
    syllabusText: `GC 4400 — Commercial Printing (Level 4)

Learning Objectives:
- Graphic design for offset/digital press
- Variable data and data management for personalized print
- Typography, copyfitting, and page layout
- Bindery and finishing
- Print-to-digital marketing triggers
- Photographic theories
- Preflighting
- Color management
- Offset and digital press operations
- Plate and press sheet production

Projects:
- Brand Specification Project
- Static Brochure Project
- Business Card with Finishing Embellishments
- Offset Lithographic Press Run
- Variable Data Versioned Booklet
- Brand Story

Assessment context: The broadest senior-level course. Touches Account Management, Brand Strategy, Production & Operations (Do-level press operation), and Creative Generalist. The "Brand Story" project — articulating how marketing collateral fits an integrated campaign — is the closest existing course to brand strategy at Do level.`,
  },
];

export function getSampleByCode(code: string): SampleSyllabus | undefined {
  return SAMPLE_SYLLABI.find(s => s.courseCode === code);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test sample-syllabi`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/sample-syllabi.ts tests/lib/domain/sample-syllabi.test.ts
git commit -m "feat: seed 6 sample syllabi from source spec for prototype examples"
```

---

## Task 6: AI provider abstraction + JSON schemas

**Files:**
- Create: `lib/ai/provider.ts`, `lib/ai/openai.ts`, `lib/ai/schemas.ts`
- Create: `tests/lib/ai/schemas.test.ts`, `tests/lib/ai/openai.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `tests/lib/ai/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  kudOutcomesSchema,
  coverageScoresSchema,
  prerequisiteClaimsSchema,
  prerequisiteGapsSchema,
} from '@/lib/ai/schemas';

describe('AI output schemas', () => {
  it('accepts valid KUDOutcomes', () => {
    const parsed = kudOutcomesSchema.parse({
      description: 'Course teaches X',
      know: ['fact one', 'fact two'],
      understand: ['why one'],
      do: ['can do one'],
    });
    expect(parsed.description).toBe('Course teaches X');
  });

  it('rejects KUDOutcomes with empty description', () => {
    expect(() => kudOutcomesSchema.parse({
      description: '',
      know: ['fact'],
      understand: ['why'],
      do: ['do'],
    })).toThrow();
  });

  it('accepts valid CoverageScore array with reasoning', () => {
    const parsed = coverageScoresSchema.parse([
      {
        subCompetencyId: 'workflow-design',
        kudLevel: 'do',
        confidence: 'high',
        reasoning: 'The Capstone Press Matching project requires students to design a workflow including curves and proofing — direct Do-level evidence.',
      },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('rejects CoverageScore with empty reasoning', () => {
    expect(() => coverageScoresSchema.parse([
      { subCompetencyId: 'x', kudLevel: 'know', confidence: 'low', reasoning: '' },
    ])).toThrow();
  });

  it('rejects CoverageScore with too-short reasoning', () => {
    expect(() => coverageScoresSchema.parse([
      { subCompetencyId: 'x', kudLevel: 'know', confidence: 'low', reasoning: 'yes' },
    ])).toThrow(/at least 20/);
  });

  it('accepts valid PrerequisiteCompetencyClaim array', () => {
    const parsed = prerequisiteClaimsSchema.parse([
      { subCompetencyId: 'color-foundations', expectedKudLevel: 'understand', rationale: 'GC 4060 cannot evaluate packaging color without baseline understanding of separation systems.' },
    ]);
    expect(parsed[0]?.expectedKudLevel).toBe('understand');
  });

  it('accepts valid PrerequisiteGap array', () => {
    const parsed = prerequisiteGapsSchema.parse([
      {
        subCompetencyId: 'color-foundations',
        expectedKudLevel: 'understand',
        status: 'underdeveloped',
        upstreamEvidence: 'GC 3460 develops color at Do level for ink chemistry but does not generalize to packaging color decisions.',
        reasoning: 'The upstream course covers the mechanics but not the application context downstream needs.',
      },
    ]);
    expect(parsed[0]?.status).toBe('underdeveloped');
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

Run: `pnpm test schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schemas**

Create `lib/ai/schemas.ts`:
```ts
import { z } from 'zod';

const reasoningField = z.string().min(20, 'reasoning must be at least 20 characters');

export const kudOutcomesSchema = z.object({
  description: z.string().min(1),
  know: z.array(z.string().min(1)).min(1).max(7),
  understand: z.array(z.string().min(1)).min(1).max(7),
  do: z.array(z.string().min(1)).min(1).max(7),
});

export const coverageScoreSchema = z.object({
  subCompetencyId: z.string().min(1),
  kudLevel: z.enum(['know', 'understand', 'do', 'not_addressed']),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: reasoningField,
});
export const coverageScoresSchema = z.array(coverageScoreSchema);

export const prerequisiteClaimSchema = z.object({
  subCompetencyId: z.string().min(1),
  expectedKudLevel: z.enum(['know', 'understand', 'do']),
  rationale: z.string().min(10),
});
export const prerequisiteClaimsSchema = z.array(prerequisiteClaimSchema);

export const prerequisiteGapSchema = z.object({
  subCompetencyId: z.string().min(1),
  expectedKudLevel: z.enum(['know', 'understand', 'do']),
  status: z.enum(['met', 'underdeveloped', 'missing']),
  upstreamEvidence: z.string().min(10),
  reasoning: reasoningField,
});
export const prerequisiteGapsSchema = z.array(prerequisiteGapSchema);

// JSON Schema (Draft 2020-12) versions for OpenAI's response_format
// These are derived from the Zod schemas above. Each is wrapped in the
// "single root object" shape that OpenAI structured-outputs requires
// (the API insists on an object, never a top-level array, so we wrap).
export const kudOutcomesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'know', 'understand', 'do'],
  properties: {
    description: { type: 'string', minLength: 1 },
    know: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
    understand: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
    do: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
  },
} as const;

export const coverageScoresJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scores'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'kudLevel', 'confidence', 'reasoning'],
        properties: {
          subCompetencyId: { type: 'string' },
          kudLevel: { type: 'string', enum: ['know', 'understand', 'do', 'not_addressed'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string', minLength: 20 },
        },
      },
    },
  },
} as const;

export const prerequisiteClaimsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'expectedKudLevel', 'rationale'],
        properties: {
          subCompetencyId: { type: 'string' },
          expectedKudLevel: { type: 'string', enum: ['know', 'understand', 'do'] },
          rationale: { type: 'string', minLength: 10 },
        },
      },
    },
  },
} as const;

export const prerequisiteGapsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'expectedKudLevel', 'status', 'upstreamEvidence', 'reasoning'],
        properties: {
          subCompetencyId: { type: 'string' },
          expectedKudLevel: { type: 'string', enum: ['know', 'understand', 'do'] },
          status: { type: 'string', enum: ['met', 'underdeveloped', 'missing'] },
          upstreamEvidence: { type: 'string', minLength: 10 },
          reasoning: { type: 'string', minLength: 20 },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 4: Run schema test**

Run: `pnpm test schemas`
Expected: 7 tests pass.

- [ ] **Step 5: Create provider interface**

Create `lib/ai/provider.ts`:
```ts
export interface AIProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Call the model with a system prompt and a user message.
   * Validates the response against the supplied JSON schema (provider-side validation
   * via response_format when the provider supports it; client-side validation always).
   * Returns the parsed object plus token/cost telemetry.
   */
  complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;            // for OpenAI structured outputs naming
    jsonSchema: object;
    validate: (raw: unknown) => T; // typically the Zod schema's parse
  }): Promise<{
    data: T;
    costUsdCents: number;
    durationMs: number;
  }>;
}
```

- [ ] **Step 6: Write failing OpenAI provider test**

Create `tests/lib/ai/openai.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '@/lib/ai/openai';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

beforeEach(() => {
  mockCreate.mockReset();
});

describe('OpenAIProvider', () => {
  it('parses a valid response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            description: 'A course',
            know: ['a'], understand: ['b'], do: ['c'],
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const provider = new OpenAIProvider('gpt-4o', 'sk-test');
    const result = await provider.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });
    expect(result.data.description).toBe('A course');
    expect(result.costUsdCents).toBeGreaterThan(0);
  });

  it('throws when response fails validation', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ description: '', know: [], understand: [], do: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const provider = new OpenAIProvider('gpt-4o', 'sk-test');
    await expect(provider.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    })).rejects.toThrow();
  });

  it('reports name and model', () => {
    const p = new OpenAIProvider('gpt-4o', 'sk-test');
    expect(p.name).toBe('openai');
    expect(p.model).toBe('gpt-4o');
  });
});
```

- [ ] **Step 7: Run test (expect failure)**

Run: `pnpm test openai`
Expected: FAIL — OpenAIProvider not exported.

- [ ] **Step 8: Implement OpenAIProvider**

Create `lib/ai/openai.ts`:
```ts
import OpenAI from 'openai';
import type { AIProvider } from './provider';

// gpt-4o price per 1M tokens (as of 2026-05; tune later)
const PRICE_INPUT_PER_M_USD = 2.5;
const PRICE_OUTPUT_PER_M_USD = 10;

function toCents(usd: number): number {
  return Math.ceil(usd * 100 * 100); // 1/100 of a cent
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly model: string;
  private client: OpenAI;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
  }): Promise<{ data: T; costUsdCents: number; durationMs: number }> {
    const started = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: args.schemaName,
          schema: args.jsonSchema,
          strict: true,
        },
      },
      temperature: 0.2,
    });
    const durationMs = Date.now() - started;

    const content = response.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI returned non-JSON content: ${content.slice(0, 200)}`);
    }
    const data = args.validate(parsed);

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const costUsdCents =
      toCents((promptTokens / 1_000_000) * PRICE_INPUT_PER_M_USD) +
      toCents((completionTokens / 1_000_000) * PRICE_OUTPUT_PER_M_USD);

    return { data, costUsdCents, durationMs };
  }
}
```

- [ ] **Step 9: Run tests**

Run: `pnpm test openai`
Expected: 3 tests pass.

- [ ] **Step 10: Add provider factory**

Append to `lib/ai/provider.ts`:
```ts
import { OpenAIProvider } from './openai';

export function getProvider(): AIProvider {
  const which = process.env.AI_PROVIDER ?? 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL ?? 'gpt-4o', key);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
```

- [ ] **Step 11: Commit**

```bash
git add lib/ai/ tests/lib/ai/
git commit -m "feat: AI provider abstraction with OpenAI implementation and Zod schemas"
```

---

## Task 7: Manning-skill-encoded prompts

Each prompt is a markdown file with YAML frontmatter declaring which Manning skills it encodes. The prompt loader composes shared fragments with the main prompt to produce one system prompt per call.

**Files:**
- Create: `lib/ai/prompts/load.ts`
- Create: `lib/ai/prompts/shared/kud-rubric.md`
- Create: `lib/ai/prompts/shared/career-target-frame.md`
- Create: `lib/ai/prompts/draft-outcomes.md`
- Create: `lib/ai/prompts/score-coverage.md`
- Create: `lib/ai/prompts/suggest-prerequisites.md`
- Create: `lib/ai/prompts/analyze-prerequisite-gaps.md`
- Create: `tests/lib/ai/load.test.ts`

- [ ] **Step 1: Check Manning skills repo accessibility**

Run:
```bash
curl -fsSL -o /dev/null https://raw.githubusercontent.com/GarethManning/education-agent-skills/main/README.md && echo "ACCESSIBLE" || echo "NOT_ACCESSIBLE"
```

If `ACCESSIBLE`: at execution time, fetch each SKILL.md you need and incorporate its specific reasoning framework. URLs follow the pattern `https://raw.githubusercontent.com/GarethManning/education-agent-skills/main/<domain>/<skill>/SKILL.md`.

If `NOT_ACCESSIBLE`: the prompts below contain a self-sufficient encoding derived from the source spec's Manning Skills Integration section (lines 742–799 of `gc-curriculum-tool-spec.md`). Use those directly without modification.

- [ ] **Step 2: Write the KUD rubric (shared)**

Create `lib/ai/prompts/shared/kud-rubric.md`:
```markdown
---
name: kud-rubric
purpose: Shared 4-level rubric included by coverage and gap-analysis prompts
---

# KUD Scoring Rubric

Coverage decisions use four levels. Apply them strictly: when in doubt, score lower, not higher. Confidence is a separate axis from level — you can be highly confident a course only reaches Know level.

**not_addressed.** The course does not touch this sub-competency in any substantive way. A passing mention or tangential exposure does not count.

**know.** The course exposes students to concepts, terminology, or facts related to this sub-competency. Students can recognize and recall, but no project requires them to apply the knowledge in new situations. Evidence: lecture content, reading lists, recall-style assessments.

**understand.** The course requires students to explain why something is true, predict consequences, or distinguish related concepts. Students can apply ideas in familiar contexts. Evidence: explanatory writing, structured problem sets, analysis assignments where the answer is not pre-given.

**do.** The course requires students to perform the competency in a context that approximates real work — with constraints, ambiguity, and judgment. The performance is assessed against criteria that real practitioners would use. Evidence: capstone-style projects, client-facing deliverables, performances scored against industry standards.

When evaluating a course's outcomes and projects, ask:
1. What level of cognitive activity does the highest-stakes assignment require?
2. Is the assignment a transferable performance (Do), an applied explanation (Understand), or a recognition task (Know)?
3. If the course outcomes language is aspirational, what do the projects actually demonstrate?

Always cite the specific outcome or project that supports your level choice in the `reasoning` field.
```

- [ ] **Step 3: Write the career-target frame (shared)**

Create `lib/ai/prompts/shared/career-target-frame.md`:
```markdown
---
name: career-target-frame
purpose: How to reason about a career target's sub-competencies when scoring or unpacking
---

# Reasoning Frame for Career Targets

A career target is the *endpoint* a graduate is being prepared for. Each target has 5–7 sub-competencies that decompose the target into assessable capabilities. The full target's Know / Understand / Do descriptors describe the *level of mastery* a graduate should achieve across the target as a whole.

When scoring a course against a sub-competency, evaluate **only the course-level evidence** (outcomes and projects). Do not assume what other courses cover. If the course does not touch this sub-competency, score `not_addressed` — do not infer from prerequisites.

When unpacking a target or assessing alignment, hold three things in tension:
1. **Disciplinary validity.** The sub-competency must describe what credible practitioners actually do, not what curriculum documents wish they did.
2. **Assessability.** It must be possible to design a Do-level performance assessment for the sub-competency. If you can't, the sub-competency is probably a mindset, not a capability.
3. **AI defensibility (for Creative Generalist and AI Workflow targets).** Where AI exposure is high, the sub-competency must describe what *humans* contribute in the AI-augmented workflow — not what AI tools do.
```

- [ ] **Step 4: Write the draft-outcomes prompt**

Create `lib/ai/prompts/draft-outcomes.md`:
```markdown
---
name: draft-outcomes
manning_skills:
  - Backwards Design (D7)
  - KUD Chart Authoring (D7)
  - Threshold Concept Translation (D7)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

You are drafting course-level KUD outcomes from a raw syllabus. Apply Backwards Design — work from the career target competencies the program is aiming to produce, not just what the syllabus says is covered.

# Process

1. Read the syllabus carefully. Identify the highest-stakes assignment and what it requires students to *do*.
2. Identify the conceptual core (the threshold concept) — the idea that, once learned, changes how students see the discipline. State it in the `description`.
3. Draft 3–5 Know bullets: facts and frameworks students should be able to recall.
4. Draft 3–5 Understand bullets: explanations students should be able to give about why and how.
5. Draft 3–5 Do bullets: transferable performances students should be able to execute.

# Constraints

- Each bullet is a single sentence in students-can-do form: "Students will Know X..." → write the bullet as just "X". The Know/Understand/Do framing is supplied by the field name.
- Avoid restating syllabus topics. Outcomes describe *what students will be different about*, not what was covered.
- Each Do bullet must describe a transferable performance — what students could do in a new context, not just inside this course.
- The description is the threshold concept: the one idea that, once grasped, reorganizes how students approach the discipline.

# Output

Return JSON matching the supplied schema. The user message will contain the syllabus text and the career target context.
```

- [ ] **Step 5: Write the score-coverage prompt**

Create `lib/ai/prompts/score-coverage.md`:
```markdown
---
name: score-coverage
manning_skills:
  - Coverage Audit (D7, D16)
  - KUD Chart Authoring (D7)
  - Assessment Validity (D7)
  - Developmental Band Translation (D16)
  - Disciplinary AI Reliability (D13)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

You are scoring a single course against the sub-competencies of one career target. For each sub-competency, decide the KUD level the course delivers and write reasoning that cites the specific evidence.

# Process

For each sub-competency in the target:

1. Read the sub-competency's Know / Understand / Do descriptors. These define what each level means *for this competency*, not in general.
2. Examine the course's outcomes and projects. Look for direct evidence — specific projects or assignments that require students to perform at one of those levels.
3. Apply the KUD rubric. Score the highest level the course's *evidence* (not its aspirations) supports.
4. Apply the developmental band consideration: a 1000-level course reaching "Know" is appropriate; a 4000-level course reaching only "Know" on its discipline's central sub-competency is a finding worth surfacing.
5. Apply disciplinary AI reliability: where the sub-competency involves AI-augmented work, be appropriately skeptical of evidence that conflates "uses AI tool" with "can direct AI work".

# Constraints

- Score every sub-competency in the target. If the course does not touch it, score `not_addressed` and explain why nothing relevant was found.
- Reasoning must cite specific evidence — name the project or outcome you found. Do not give generic justifications.
- Confidence is `high` only when the evidence is unambiguous. Most scores should be `medium`. Use `low` when the syllabus is thin or the evidence is interpretive.

# Output

Return JSON matching the supplied schema. The `scores` array contains one object per sub-competency in the target, in the same order as supplied.
```

- [ ] **Step 6: Write the suggest-prerequisites prompt**

Create `lib/ai/prompts/suggest-prerequisites.md`:
```markdown
---
name: suggest-prerequisites
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Backwards Design (D7)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

Given a course's outcomes and projects, identify what competencies students should walk into this course already possessing — at what KUD level — for the course to function as designed.

# Process

1. For each Do-level outcome in the course, work backward: what would students need to already Understand to be able to Do this?
2. For each major project, identify the prerequisite knowledge or skill the project assumes. If the project assumes students can already use a tool, that's a Know-level prerequisite. If it assumes they can explain why a process is structured a certain way, that's Understand.
3. Cross-reference against the supplied list of all sub-competencies. Only return prerequisites that map to a sub-competency — do not invent new categories.
4. Be selective. A course typically expects 3–7 prerequisite competencies; do not exhaustively list everything in the catalog.

# Constraints

- Each prerequisite must reference an existing sub-competency by id.
- `expectedKudLevel` must be `know`, `understand`, or `do` — never `not_addressed` (a prerequisite that's "not addressed" is a missing prerequisite, not an expected one).
- The rationale must explain why this course specifically needs this competency at this level — not why competencies in general matter.

# Output

Return JSON matching the supplied schema. The `claims` array contains one object per identified prerequisite competency.
```

- [ ] **Step 7: Write the analyze-prerequisite-gaps prompt**

Create `lib/ai/prompts/analyze-prerequisite-gaps.md`:
```markdown
---
name: analyze-prerequisite-gaps
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Developmental Band Translation (D16)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

Given a downstream course's prerequisite competencies and the coverage of upstream courses against the same career target, determine whether each prerequisite is *met*, *underdeveloped*, or *missing*.

# Process

For each prerequisite competency:

1. Look at the upstream course coverage for the same sub-competency. What KUD level does it actually reach?
2. Compare to the prerequisite's expected level.
   - If upstream meets or exceeds the expected level: status is `met`.
   - If upstream addresses the sub-competency but at a lower level than expected: status is `underdeveloped`.
   - If no upstream course addresses the sub-competency at all (`not_addressed` across the board): status is `missing`.
3. Write `upstreamEvidence` describing concretely what the upstream course(s) develop — the actual KUD level reached and why. This is the faculty's "what is actually happening" picture.
4. Write `reasoning` explaining the gap: why the gap matters for the downstream course given its specific outcomes and projects. Not generic; specific to this pair.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Be honest about underdeveloped vs missing — these are different findings with different implications.
- If the upstream coverage shows the sub-competency at the expected level but in a *different context* than the downstream course needs, flag it as `underdeveloped` and explain the contextual mismatch in `reasoning`. This is the most common real-world failure mode.

# Output

Return JSON matching the supplied schema. The `gaps` array contains one object per prerequisite competency supplied.
```

- [ ] **Step 8: Implement the prompt loader**

Create `lib/ai/prompts/load.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROMPT_DIR = join(process.cwd(), 'lib/ai/prompts');

type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps';

interface ParsedPrompt {
  frontmatter: Record<string, unknown>;
  body: string;
  includes: string[];
}

function parseFrontmatter(raw: string): ParsedPrompt {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw, includes: [] };
  }
  const fmRaw = match[1] ?? '';
  const body = match[2] ?? '';
  // Tiny YAML reader: only handles the fields we use (name, manning_skills, includes).
  const includes: string[] = [];
  const includesMatch = fmRaw.match(/includes:\n((?:\s*-\s+\S.*\n?)+)/);
  if (includesMatch && includesMatch[1]) {
    for (const line of includesMatch[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)\s*$/);
      if (m && m[1]) includes.push(m[1].trim());
    }
  }
  return { frontmatter: {}, body, includes };
}

async function readPrompt(relPath: string): Promise<string> {
  return readFile(join(PROMPT_DIR, relPath), 'utf-8');
}

export async function loadPrompt(name: PromptName): Promise<string> {
  const main = await readPrompt(`${name}.md`);
  const parsed = parseFrontmatter(main);
  const includes = await Promise.all(parsed.includes.map(p => readPrompt(p)));
  const parts: string[] = [];
  for (const inc of includes) {
    parts.push(parseFrontmatter(inc).body.trim());
  }
  parts.push(parsed.body.trim());
  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 9: Write loader test**

Create `tests/lib/ai/load.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@/lib/ai/prompts/load';

describe('prompt loader', () => {
  it('composes shared rubric into draft-outcomes', async () => {
    const composed = await loadPrompt('draft-outcomes');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('Reasoning Frame for Career Targets');
    expect(composed).toContain('drafting course-level KUD outcomes');
  });

  it('composes shared rubric into score-coverage', async () => {
    const composed = await loadPrompt('score-coverage');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('scoring a single course');
  });

  it('composes shared rubric into analyze-prerequisite-gaps', async () => {
    const composed = await loadPrompt('analyze-prerequisite-gaps');
    expect(composed).toContain('KUD Scoring Rubric');
    expect(composed).toContain('met, underdeveloped, or missing');
  });
});
```

- [ ] **Step 10: Run loader test**

Run: `pnpm test load`
Expected: 3 tests pass.

- [ ] **Step 11: Commit**

```bash
git add lib/ai/prompts/ tests/lib/ai/load.test.ts
git commit -m "feat: Manning-skill-encoded prompts with shared rubric composition"
```

---

## Task 8: Analyze endpoint orchestration

**Files:**
- Create: `app/api/analyze/route.ts`
- Create: `tests/api/analyze.test.ts`
- Create: `lib/ai/fake-provider.ts` (testing only)

- [ ] **Step 1: Write fake provider**

Create `lib/ai/fake-provider.ts`:
```ts
import type { AIProvider } from './provider';

type FakeResponse = unknown;

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  private responses: FakeResponse[];
  private callCount = 0;

  constructor(responses: FakeResponse[]) {
    this.responses = responses;
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
  }): Promise<{ data: T; costUsdCents: number; durationMs: number }> {
    const idx = this.callCount++;
    if (idx >= this.responses.length) {
      throw new Error(`FakeProvider exhausted at call ${idx}`);
    }
    const data = args.validate(this.responses[idx]);
    return { data, costUsdCents: 5, durationMs: 10 };
  }

  reset() {
    this.callCount = 0;
  }
}
```

- [ ] **Step 2: Write failing analyze endpoint test**

Create `tests/api/analyze.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/analyze/route';
import { FakeProvider } from '@/lib/ai/fake-provider';
import * as providerModule from '@/lib/ai/provider';
import * as queriesModule from '@/lib/db/queries';

vi.mock('@/lib/db/queries', () => ({
  insertRun: vi.fn().mockResolvedValue({ id: 'fake-run-id' }),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an AnalysisResult on valid input', async () => {
    const upstreamKud = { description: 'Upstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const downstreamKud = { description: 'Downstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'The capstone project demonstrates Do-level workflow design as documented in the syllabus.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Downstream needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', upstreamEvidence: 'Upstream achieves Do level.', reasoning: 'Upstream exceeds the expected level so the prerequisite is met.' },
    ]};

    const fake = new FakeProvider([
      upstreamKud,           // call 1: draft outcomes for upstream
      downstreamKud,         // call 2: draft outcomes for downstream
      coverage,              // call 3: score upstream coverage
      coverage,              // call 4: score downstream coverage
      prereqClaims,          // call 5: suggest prereqs for downstream
      gaps,                  // call 6: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstream: { courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here' },
      downstream: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstream.kud.description).toBe('Upstream course');
    expect(body.downstream.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('rejects with 400 when career target id is unknown', async () => {
    const req = makeRequest({
      careerTargetId: 'unknown-target',
      upstream: { syllabusText: 'x' },
      downstream: { syllabusText: 'y' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when a syllabus is missing or too short', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstream: { syllabusText: '' },
      downstream: { syllabusText: 'y' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test (expect failure)**

Run: `pnpm test analyze`
Expected: FAIL — route handler not found.

- [ ] **Step 4: Implement analyze endpoint**

Create `app/api/analyze/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getTargetById } from '@/lib/domain/seed-targets';
import { insertRun } from '@/lib/db/queries';
import {
  kudOutcomesSchema, kudOutcomesJsonSchema,
  coverageScoresSchema, coverageScoresJsonSchema,
  prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema,
  prerequisiteGapsSchema, prerequisiteGapsJsonSchema,
} from '@/lib/ai/schemas';
import type { AnalysisResult, KUDOutcomes, CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap } from '@/lib/domain/types';

const requestSchema = z.object({
  careerTargetId: z.string(),
  upstream: z.object({
    courseLabel: z.string().optional(),
    syllabusText: z.string().min(50),
  }),
  downstream: z.object({
    courseLabel: z.string().optional(),
    syllabusText: z.string().min(50),
  }),
});

function hashIp(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

function buildTargetContext(target: ReturnType<typeof getTargetById>): string {
  if (!target) return '';
  const lines: string[] = [
    `Career Target: ${target.name}`,
    `Definition: ${target.shortDefinition}`,
    `Defensibility note: ${target.defensibilityNote}`,
    '',
    'Sub-competencies:',
  ];
  for (const sc of target.subCompetencies) {
    lines.push(`- id=${sc.id} :: ${sc.name}`);
    lines.push(`    Know: ${sc.knowDescriptor}`);
    lines.push(`    Understand: ${sc.understandDescriptor}`);
    lines.push(`    Do: ${sc.doDescriptor}`);
  }
  return lines.join('\n');
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { careerTargetId, upstream, downstream } = parsed.data;

  const target = getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  const provider = getProvider();
  const targetContext = buildTargetContext(target);

  const draftPrompt = await loadPrompt('draft-outcomes');
  const scorePrompt = await loadPrompt('score-coverage');
  const prereqPrompt = await loadPrompt('suggest-prerequisites');
  const gapPrompt = await loadPrompt('analyze-prerequisite-gaps');

  let totalCost = 0;
  const started = Date.now();

  // Call 1: Draft upstream KUD
  const upstreamKudCall = await provider.complete({
    systemPrompt: draftPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${upstream.syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
  });
  totalCost += upstreamKudCall.costUsdCents;
  const upstreamKud: KUDOutcomes = upstreamKudCall.data;

  // Call 2: Draft downstream KUD
  const downstreamKudCall = await provider.complete({
    systemPrompt: draftPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${downstream.syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
  });
  totalCost += downstreamKudCall.costUsdCents;
  const downstreamKud: KUDOutcomes = downstreamKudCall.data;

  // Calls 3 & 4: Score coverage for both courses
  const scoreFor = async (courseLabel: string, kud: KUDOutcomes): Promise<CoverageScore[]> => {
    const userMsg = `Career target:\n${targetContext}\n\nCourse: ${courseLabel}\n\nCourse description: ${kud.description}\n\nKnow outcomes:\n${kud.know.map(b => `- ${b}`).join('\n')}\n\nUnderstand outcomes:\n${kud.understand.map(b => `- ${b}`).join('\n')}\n\nDo outcomes:\n${kud.do.map(b => `- ${b}`).join('\n')}`;
    const call = await provider.complete({
      systemPrompt: scorePrompt,
      userMessage: userMsg,
      schemaName: 'coverage_scores',
      jsonSchema: coverageScoresJsonSchema,
      validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
    });
    totalCost += call.costUsdCents;
    return call.data;
  };

  const upstreamCoverage = await scoreFor(upstream.courseLabel ?? 'Upstream course', upstreamKud);
  const downstreamCoverage = await scoreFor(downstream.courseLabel ?? 'Downstream course', downstreamKud);

  // Call 5: Suggest prerequisites for downstream
  const prereqMsg = `Career target:\n${targetContext}\n\nDownstream course outcomes:\nDescription: ${downstreamKud.description}\nKnow: ${downstreamKud.know.join('; ')}\nUnderstand: ${downstreamKud.understand.join('; ')}\nDo: ${downstreamKud.do.join('; ')}`;
  const prereqCall = await provider.complete({
    systemPrompt: prereqPrompt,
    userMessage: prereqMsg,
    schemaName: 'prerequisite_claims',
    jsonSchema: prerequisiteClaimsJsonSchema,
    validate: (raw) => prerequisiteClaimsSchema.parse((raw as { claims: unknown }).claims),
  });
  totalCost += prereqCall.costUsdCents;
  const prereqs: PrerequisiteCompetencyClaim[] = prereqCall.data;

  // Call 6: Analyze gaps
  const gapMsg = `Career target:\n${targetContext}\n\nDownstream prerequisite competencies:\n${prereqs.map(p => `- ${p.subCompetencyId} (expects ${p.expectedKudLevel}): ${p.rationale}`).join('\n')}\n\nUpstream course coverage (KUD level per sub-competency):\n${upstreamCoverage.map(c => `- ${c.subCompetencyId}: ${c.kudLevel} (confidence ${c.confidence}) — ${c.reasoning}`).join('\n')}`;
  const gapCall = await provider.complete({
    systemPrompt: gapPrompt,
    userMessage: gapMsg,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
  });
  totalCost += gapCall.costUsdCents;
  const gaps: PrerequisiteGap[] = gapCall.data;

  const result: AnalysisResult = {
    upstream: { kud: upstreamKud, coverage: upstreamCoverage },
    downstream: { kud: downstreamKud, coverage: downstreamCoverage, prerequisiteCompetencies: prereqs, prerequisiteGaps: gaps },
    careerTargetId,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totalCost,
    },
  };

  // Persist run
  await insertRun({
    ipHash: hashIp(req),
    careerTargetId,
    upstreamCourseLabel: upstream.courseLabel ?? null,
    downstreamCourseLabel: downstream.courseLabel ?? null,
    upstreamSyllabus: upstream.syllabusText,
    downstreamSyllabus: downstream.syllabusText,
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totalCost,
    durationMs: result.meta.durationMs,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 5: Add the queries stub used in tests**

Create `lib/db/queries.ts`:
```ts
import { db } from './client';
import { prototypeRuns, prototypeFlags } from './schema';
import { eq, desc } from 'drizzle-orm';
import type { AnalysisResult } from '@/lib/domain/types';

export interface InsertRunInput {
  ipHash: string;
  careerTargetId: string;
  upstreamCourseLabel: string | null;
  downstreamCourseLabel: string | null;
  upstreamSyllabus: string;
  downstreamSyllabus: string;
  result: AnalysisResult;
  aiProvider: string;
  aiModel: string;
  costUsdCents: number;
  durationMs: number;
}

export async function insertRun(input: InsertRunInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeRuns).values({
    ipHash: input.ipHash,
    careerTargetId: input.careerTargetId,
    upstreamCourseLabel: input.upstreamCourseLabel,
    downstreamCourseLabel: input.downstreamCourseLabel,
    upstreamSyllabus: input.upstreamSyllabus,
    downstreamSyllabus: input.downstreamSyllabus,
    result: input.result,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    costUsdCents: input.costUsdCents,
    durationMs: input.durationMs,
  }).returning({ id: prototypeRuns.id });
  if (!row) throw new Error('insertRun: no row returned');
  return row;
}

export interface InsertFlagInput {
  runId: string;
  flagType: 'coverage' | 'prerequisite_gap' | 'kud_draft';
  target: string;
  note: string;
}

export async function insertFlag(input: InsertFlagInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeFlags).values(input).returning({ id: prototypeFlags.id });
  if (!row) throw new Error('insertFlag: no row returned');
  return row;
}

export async function listFlags(): Promise<Array<typeof prototypeFlags.$inferSelect>> {
  return db.select().from(prototypeFlags).orderBy(desc(prototypeFlags.createdAt)).limit(100);
}
```

- [ ] **Step 6: Run analyze test**

Run: `pnpm test analyze`
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/analyze/ lib/ai/fake-provider.ts lib/db/queries.ts tests/api/analyze.test.ts
git commit -m "feat: analyze endpoint orchestrates 6 AI calls into an AnalysisResult"
```

---

## Task 9: Flag endpoint

**Files:**
- Create: `app/api/flag/route.ts`
- Create: `tests/api/flag.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/api/flag.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/flag/route';

vi.mock('@/lib/db/queries', () => ({
  insertFlag: vi.fn().mockResolvedValue({ id: 'flag-id' }),
}));

import * as queries from '@/lib/db/queries';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/flag', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/flag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a valid flag', async () => {
    const req = makeRequest({
      runId: '11111111-2222-3333-4444-555555555555',
      flagType: 'coverage',
      target: 'upstream.brand-positioning',
      note: 'The AI thinks this course addresses positioning but the only project is a logo.',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('flag-id');
    expect(queries.insertFlag).toHaveBeenCalledWith({
      runId: '11111111-2222-3333-4444-555555555555',
      flagType: 'coverage',
      target: 'upstream.brand-positioning',
      note: expect.stringContaining('logo'),
    });
  });

  it('rejects empty note with 400', async () => {
    const req = makeRequest({ runId: '11111111-2222-3333-4444-555555555555', flagType: 'coverage', target: 'x', note: '' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects unknown flagType with 400', async () => {
    const req = makeRequest({ runId: '11111111-2222-3333-4444-555555555555', flagType: 'unknown', target: 'x', note: 'real note here' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

Run: `pnpm test flag`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement endpoint**

Create `app/api/flag/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { insertFlag } from '@/lib/db/queries';

const flagSchema = z.object({
  runId: z.string().uuid(),
  flagType: z.enum(['coverage', 'prerequisite_gap', 'kud_draft']),
  target: z.string().min(1),
  note: z.string().min(1).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = flagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await insertFlag(parsed.data);
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test flag`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/flag/ tests/api/flag.test.ts
git commit -m "feat: flag endpoint persists faculty pushback on AI reasoning"
```

---

## Task 10: Health endpoint

**Files:**
- Create: `app/api/health/route.ts`
- Create: `tests/api/health.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/api/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns ok with provider name', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.aiProvider).toBe('openai');
  });
});
```

- [ ] **Step 2: Run (expect failure)**

Run: `pnpm test health`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    aiProvider: process.env.AI_PROVIDER ?? 'openai',
    aiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
    time: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test health`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/health/ tests/api/health.test.ts
git commit -m "feat: health endpoint reports provider and time"
```

---

## Task 11: shadcn/ui setup + base components

**Files:**
- Create: `components.json`, multiple files under `components/ui/`
- Modify: `app/globals.css`, `tailwind.config.ts`

- [ ] **Step 1: Initialize shadcn/ui**

Run:
```bash
pnpm dlx shadcn@latest init --yes \
  --base-color slate --css-variables true \
  --tailwind-config tailwind.config.ts \
  --tailwind-prefix '' \
  --rsc true --tsx true \
  --import-alias '@/components' --utils-alias '@/lib/utils' \
  --components-dir components/ui
```

When prompted to overwrite `app/globals.css`, accept.

- [ ] **Step 2: Add the components we need**

Run:
```bash
pnpm dlx shadcn@latest add button card textarea select label dialog badge separator --yes
```

Expected: Files appear in `components/ui/`.

- [ ] **Step 3: Smoke test build**

Run: `pnpm build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add components.json components/ui/ app/globals.css tailwind.config.ts lib/utils.ts
git commit -m "feat: shadcn/ui base components (button, card, textarea, select, dialog, badge, separator)"
```

---

## Task 12: PrototypeForm component

**Files:**
- Create: `components/PrototypeForm.tsx`, `components/SampleSyllabusButton.tsx`
- Create: `tests/components/PrototypeForm.test.tsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/PrototypeForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrototypeForm } from '@/components/PrototypeForm';

describe('PrototypeForm', () => {
  it('renders the three inputs and the Analyze button', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    expect(screen.getByLabelText(/upstream course/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/downstream course/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/career target/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('disables Analyze when syllabi are blank', () => {
    render(<PrototypeForm onAnalyze={vi.fn()} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /analyze/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAnalyze with the values when submitted', async () => {
    const onAnalyze = vi.fn();
    render(<PrototypeForm onAnalyze={onAnalyze} isAnalyzing={false} />);
    fireEvent.change(screen.getByLabelText(/upstream course syllabus/i), { target: { value: 'A'.repeat(100) } });
    fireEvent.change(screen.getByLabelText(/downstream course syllabus/i), { target: { value: 'B'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: expect.any(String),
      upstream: { courseLabel: '', syllabusText: 'A'.repeat(100) },
      downstream: { courseLabel: '', syllabusText: 'B'.repeat(100) },
    });
  });
});
```

- [ ] **Step 2: Implement SampleSyllabusButton**

Create `components/SampleSyllabusButton.tsx`:
```tsx
'use client';

import { Button } from '@/components/ui/button';
import { SAMPLE_SYLLABI } from '@/lib/domain/sample-syllabi';

interface Props {
  onLoad: (courseLabel: string, text: string) => void;
}

export function SampleSyllabusButton({ onLoad }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs text-muted-foreground self-center">Load example:</span>
      {SAMPLE_SYLLABI.map(s => (
        <Button
          key={s.courseCode}
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onLoad(s.courseCode, s.syllabusText)}
        >
          {s.courseCode}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement PrototypeForm**

Create `components/PrototypeForm.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SampleSyllabusButton } from './SampleSyllabusButton';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

export interface AnalyzeInput {
  careerTargetId: string;
  upstream: { courseLabel: string; syllabusText: string };
  downstream: { courseLabel: string; syllabusText: string };
}

interface Props {
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

export function PrototypeForm({ onAnalyze, isAnalyzing }: Props) {
  const [careerTargetId, setCareerTargetId] = useState(CAREER_TARGETS[0]?.id ?? '');
  const [upstreamLabel, setUpstreamLabel] = useState('');
  const [upstreamText, setUpstreamText] = useState('');
  const [downstreamLabel, setDownstreamLabel] = useState('');
  const [downstreamText, setDownstreamText] = useState('');

  const canSubmit = upstreamText.length >= 50 && downstreamText.length >= 50 && !isAnalyzing;

  function handleSubmit() {
    onAnalyze({
      careerTargetId,
      upstream: { courseLabel: upstreamLabel, syllabusText: upstreamText },
      downstream: { courseLabel: downstreamLabel, syllabusText: downstreamText },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyze two courses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="upstream-syllabus">Upstream course syllabus</Label>
          <SampleSyllabusButton onLoad={(code, text) => { setUpstreamLabel(code); setUpstreamText(text); }} />
          <Textarea
            id="upstream-syllabus"
            aria-label="Upstream course syllabus"
            placeholder="Paste the syllabus of the earlier course in the sequence..."
            rows={10}
            value={upstreamText}
            onChange={(e) => setUpstreamText(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="downstream-syllabus">Downstream course syllabus</Label>
          <SampleSyllabusButton onLoad={(code, text) => { setDownstreamLabel(code); setDownstreamText(text); }} />
          <Textarea
            id="downstream-syllabus"
            aria-label="Downstream course syllabus"
            placeholder="Paste the syllabus of the later course in the sequence..."
            rows={10}
            value={downstreamText}
            onChange={(e) => setDownstreamText(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="career-target">Career target</Label>
          <Select value={careerTargetId} onValueChange={setCareerTargetId}>
            <SelectTrigger id="career-target" aria-label="Career target">
              <SelectValue placeholder="Choose a target" />
            </SelectTrigger>
            <SelectContent>
              {CAREER_TARGETS.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="lg" onClick={handleSubmit} disabled={!canSubmit}>
          {isAnalyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test PrototypeForm`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/PrototypeForm.tsx components/SampleSyllabusButton.tsx tests/components/PrototypeForm.test.tsx
git commit -m "feat: PrototypeForm with two syllabi inputs, target dropdown, and sample loaders"
```

---

## Task 13: Output components — KUDCard, CoverageHeatMap, PrerequisiteGapPanel

**Files:**
- Create: `components/KUDCard.tsx`, `components/CoverageHeatMap.tsx`, `components/PrerequisiteGapPanel.tsx`, `components/ReasoningExpand.tsx`, `components/FlagDialog.tsx`
- Create: `tests/components/CoverageHeatMap.test.tsx`, `tests/components/PrerequisiteGapPanel.test.tsx`

- [ ] **Step 1: Implement FlagDialog (used by both heat map cells and gap rows)**

Create `components/FlagDialog.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => Promise<void>;
  context: string;
}

export function FlagDialog({ open, onOpenChange, onSubmit, context }: Props) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (note.trim().length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(note);
      setNote('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Flag this AI reasoning</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{context}</p>
        <Textarea
          placeholder="What is specifically wrong with the AI's reasoning? (Faculty pushback gets used to tune prompts.)"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || note.trim().length === 0}>
            {submitting ? 'Saving…' : 'Submit flag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement ReasoningExpand**

Create `components/ReasoningExpand.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FlagDialog } from './FlagDialog';

interface Props {
  reasoning: string;
  flagContext: string;          // human-readable description of what's being flagged
  onFlag: (note: string) => Promise<void>;
}

export function ReasoningExpand({ reasoning, flagContext, onFlag }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
        {expanded ? 'Hide reasoning' : 'Show AI reasoning'}
      </Button>
      {expanded && (
        <div className="rounded border border-border bg-muted/40 p-3 text-sm leading-relaxed">
          {reasoning}
          <div className="mt-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Flag this reasoning
            </Button>
          </div>
        </div>
      )}
      <FlagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={onFlag}
        context={flagContext}
      />
    </div>
  );
}
```

- [ ] **Step 3: Implement KUDCard**

Create `components/KUDCard.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KUDOutcomes } from '@/lib/domain/types';

interface Props {
  courseLabel: string;
  kud: KUDOutcomes;
}

export function KUDCard({ courseLabel, kud }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{courseLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Threshold concept</p>
          <p className="mt-1 italic">{kud.description}</p>
        </div>
        <Section title="Know" items={kud.know} />
        <Section title="Understand" items={kud.understand} />
        <Section title="Do" items={kud.do} />
      </CardContent>
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 space-y-1">
        {items.map((it, i) => <li key={i} className="text-sm">{it}</li>)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Write CoverageHeatMap test**

Create `tests/components/CoverageHeatMap.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import type { CareerTarget, CoverageScore } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production & Ops',
  shortDefinition: '',
  industryContexts: [],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: '',
  socCode: null,
  subCompetencies: [
    { id: 'workflow-design', name: 'Workflow design', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
    { id: 'quality-control', name: 'Quality control', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
  ],
};

const upstream: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Upstream workflow reasoning here that is long enough.' },
  { subCompetencyId: 'quality-control', kudLevel: 'understand', confidence: 'medium', reasoning: 'Upstream quality reasoning here.' },
];

const downstream: CoverageScore[] = [
  { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Downstream workflow reasoning here.' },
  { subCompetencyId: 'quality-control', kudLevel: 'do', confidence: 'high', reasoning: 'Downstream quality reasoning here.' },
];

describe('CoverageHeatMap', () => {
  it('renders one column per sub-competency and one row per course', () => {
    render(<CoverageHeatMap target={target} upstreamLabel="GC 3460" upstreamScores={upstream} downstreamLabel="GC 4060" downstreamScores={downstream} onFlag={vi.fn()} />);
    expect(screen.getByText('GC 3460')).toBeInTheDocument();
    expect(screen.getByText('GC 4060')).toBeInTheDocument();
    expect(screen.getByText('Workflow design')).toBeInTheDocument();
    expect(screen.getByText('Quality control')).toBeInTheDocument();
  });

  it('expands reasoning when a cell is clicked', () => {
    render(<CoverageHeatMap target={target} upstreamLabel="GC 3460" upstreamScores={upstream} downstreamLabel="GC 4060" downstreamScores={downstream} onFlag={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /show ai reasoning/i })[0]!);
    expect(screen.getByText(/Upstream workflow reasoning/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement CoverageHeatMap**

Create `components/CoverageHeatMap.tsx`:
```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReasoningExpand } from './ReasoningExpand';
import type { CareerTarget, CoverageScore, KUDLevel } from '@/lib/domain/types';

const LEVEL_BG: Record<KUDLevel, string> = {
  do: 'bg-emerald-700 text-white',
  understand: 'bg-yellow-600 text-white',
  know: 'bg-amber-400 text-black',
  not_addressed: 'bg-slate-700 text-slate-200',
};

const LEVEL_LABEL: Record<KUDLevel, string> = {
  do: 'Do',
  understand: 'Understand',
  know: 'Know',
  not_addressed: '—',
};

interface Props {
  target: CareerTarget;
  upstreamLabel: string;
  upstreamScores: CoverageScore[];
  downstreamLabel: string;
  downstreamScores: CoverageScore[];
  onFlag: (target: string, note: string) => Promise<void>;
}

export function CoverageHeatMap({ target, upstreamLabel, upstreamScores, downstreamLabel, downstreamScores, onFlag }: Props) {
  const cellFor = (scores: CoverageScore[], subId: string) => scores.find(s => s.subCompetencyId === subId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coverage of <em>{target.name}</em></CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left p-2 sticky left-0 bg-background text-sm font-normal text-muted-foreground"> </th>
                {target.subCompetencies.map(sc => (
                  <th key={sc.id} className="text-left p-2 text-xs font-medium align-bottom min-w-[140px]">
                    {sc.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { label: upstreamLabel || 'Upstream', scores: upstreamScores, side: 'upstream' as const },
                { label: downstreamLabel || 'Downstream', scores: downstreamScores, side: 'downstream' as const },
              ]).map(({ label, scores, side }) => (
                <tr key={side}>
                  <td className="p-2 font-medium text-sm align-top">{label}</td>
                  {target.subCompetencies.map(sc => {
                    const c = cellFor(scores, sc.id);
                    if (!c) {
                      return <td key={sc.id} className="p-2 align-top"><div className="rounded p-2 bg-slate-200 text-slate-700 text-xs">No data</div></td>;
                    }
                    return (
                      <td key={sc.id} className="p-2 align-top">
                        <div className={`rounded p-2 ${LEVEL_BG[c.kudLevel]}`}>
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-semibold text-xs">{LEVEL_LABEL[c.kudLevel]}</span>
                            <span className="text-[10px] uppercase tracking-wider opacity-80">{c.confidence}</span>
                          </div>
                          <div className="mt-2">
                            <ReasoningExpand
                              reasoning={c.reasoning}
                              flagContext={`${label} • ${sc.name} • ${LEVEL_LABEL[c.kudLevel]}`}
                              onFlag={(note) => onFlag(`${side}.${sc.id}`, note)}
                            />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Write PrerequisiteGapPanel test**

Create `tests/components/PrerequisiteGapPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import type { CareerTarget, PrerequisiteGap } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations', name: 'Production & Ops',
  shortDefinition: '', industryContexts: [],
  knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
  defensibilityNote: '', socCode: null,
  subCompetencies: [
    { id: 'workflow-design', name: 'Workflow design', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
    { id: 'quality-control', name: 'Quality control', knowDescriptor: '', understandDescriptor: '', doDescriptor: '' },
  ],
};

const gaps: PrerequisiteGap[] = [
  { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', upstreamEvidence: 'Upstream develops it at Do level.', reasoning: 'Prereq is met because upstream exceeds the expected level.' },
  { subCompetencyId: 'quality-control', expectedKudLevel: 'understand', status: 'missing', upstreamEvidence: 'Nothing upstream addresses this.', reasoning: 'No upstream course covers quality control; downstream will be teaching it from zero.' },
];

describe('PrerequisiteGapPanel', () => {
  it('renders one row per gap with status badge', () => {
    render(<PrerequisiteGapPanel target={target} gaps={gaps} onFlag={vi.fn()} />);
    expect(screen.getByText(/Workflow design/i)).toBeInTheDocument();
    expect(screen.getByText(/Quality control/i)).toBeInTheDocument();
    expect(screen.getByText(/Met/i)).toBeInTheDocument();
    expect(screen.getByText(/Missing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Implement PrerequisiteGapPanel**

Create `components/PrerequisiteGapPanel.tsx`:
```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ReasoningExpand } from './ReasoningExpand';
import type { CareerTarget, PrerequisiteGap, GapStatus } from '@/lib/domain/types';

const STATUS_COLOR: Record<GapStatus, string> = {
  met: 'bg-emerald-700 text-white',
  underdeveloped: 'bg-amber-500 text-black',
  missing: 'bg-red-700 text-white',
};

const STATUS_LABEL: Record<GapStatus, string> = {
  met: 'Met',
  underdeveloped: 'Underdeveloped',
  missing: 'Missing',
};

interface Props {
  target: CareerTarget;
  gaps: PrerequisiteGap[];
  onFlag: (target: string, note: string) => Promise<void>;
}

export function PrerequisiteGapPanel({ target, gaps, onFlag }: Props) {
  const nameOf = (id: string) => target.subCompetencies.find(s => s.id === id)?.name ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prerequisite gap analysis</CardTitle>
        <p className="text-sm text-muted-foreground">
          What the downstream course expects students to walk in with, and whether the upstream course actually develops it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {gaps.length === 0 && <p className="text-sm text-muted-foreground italic">No prerequisite competencies were identified.</p>}
        {gaps.map((g, i) => (
          <div key={i} className="border border-border rounded p-4 space-y-2">
            <div className="flex justify-between items-baseline gap-4">
              <div>
                <p className="font-medium">{nameOf(g.subCompetencyId)}</p>
                <p className="text-xs text-muted-foreground">Expected at: <strong>{g.expectedKudLevel}</strong></p>
              </div>
              <Badge className={STATUS_COLOR[g.status]}>{STATUS_LABEL[g.status]}</Badge>
            </div>
            <p className="text-sm"><strong>What upstream actually does:</strong> {g.upstreamEvidence}</p>
            <ReasoningExpand
              reasoning={g.reasoning}
              flagContext={`Prereq gap • ${nameOf(g.subCompetencyId)} • ${STATUS_LABEL[g.status]}`}
              onFlag={(note) => onFlag(`gap.${g.subCompetencyId}`, note)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Run all component tests**

Run: `pnpm test components`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add components/ tests/components/
git commit -m "feat: output components (KUDCard, CoverageHeatMap, PrerequisiteGapPanel, ReasoningExpand, FlagDialog)"
```

---

## Task 14: Prototype page integration

**Files:**
- Create: `app/preview/[slug]/page.tsx`
- Modify: `app/page.tsx` (becomes landing with link to preview slug)
- Modify: `app/layout.tsx` (title + meta)
- Create: `lib/slug.ts`

- [ ] **Step 1: Implement slug helper**

Create `lib/slug.ts`:
```ts
export function getPrototypeSlug(): string {
  const slug = process.env.PROTOTYPE_SLUG;
  if (!slug || slug.length < 8) {
    throw new Error('PROTOTYPE_SLUG must be set to a value of at least 8 characters');
  }
  return slug;
}

export function isValidSlug(candidate: string): boolean {
  try { return candidate === getPrototypeSlug(); } catch { return false; }
}
```

- [ ] **Step 2: Update root layout**

Replace `app/layout.tsx` entirely with:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GC Curriculum Tool — Prototype',
  description: 'A prototype for the Clemson Graphic Communications curriculum design tool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Replace root page with redirect notice**

Replace `app/page.tsx` entirely:
```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-12">
      <h1 className="text-3xl font-semibold">GC Curriculum Tool — Prototype</h1>
      <p className="mt-4 text-muted-foreground">
        This site is hosting a private faculty-facing prototype. If you have the preview link from Chip, follow it directly.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        If you're a faculty member at GC and don't have the link, email <a className="underline" href="mailto:chiptoe@mac.com">chiptoe@mac.com</a> for access.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Implement the preview page**

Create `app/preview/[slug]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { isValidSlug } from '@/lib/slug';
import { PrototypeClient } from './PrototypeClient';

export const dynamic = 'force-dynamic';

export default async function PreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) {
    notFound();
  }
  return <PrototypeClient />;
}
```

Then create `app/preview/[slug]/PrototypeClient.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { PrototypeForm, type AnalyzeInput } from '@/components/PrototypeForm';
import { KUDCard } from '@/components/KUDCard';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import { Separator } from '@/components/ui/separator';
import { CAREER_TARGETS, getTargetById } from '@/lib/domain/seed-targets';
import type { AnalysisResult } from '@/lib/domain/types';

export function PrototypeClient() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [labels, setLabels] = useState<{ up: string; down: string }>({ up: 'Upstream', down: 'Downstream' });
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(input: AnalyzeInput) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setLabels({ up: input.upstream.courseLabel || 'Upstream', down: input.downstream.courseLabel || 'Downstream' });
    try {
      const resp = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Analysis failed: ${resp.status} ${text.slice(0, 200)}`);
      }
      const body = (await resp.json()) as AnalysisResult & { runId?: string };
      setResult(body);
      if (body.runId) setRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFlag(target: string, note: string, flagType: 'coverage' | 'prerequisite_gap' | 'kud_draft') {
    if (!runId) return;
    await fetch('/api/flag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, flagType, target, note }) });
  }

  const target = result ? getTargetById(result.careerTargetId) : null;

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-12 space-y-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Clemson GC — Curriculum Tool Prototype</p>
        <h1 className="text-4xl font-semibold leading-tight">A working preview of how the curriculum tool will analyze courses.</h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          The full tool will be a living record of the GC curriculum — courses, career targets, and the AI analysis that maps how well one builds toward the other. This prototype lets you test the analysis on any two courses you choose. Paste the syllabus of an earlier course and a later course in the sequence, pick a career target, and the AI will draft course-level Know / Understand / Do outcomes, score coverage against the target's sub-competencies, and identify whether the later course's prerequisites are actually met by the earlier one.
        </p>
        <p className="text-sm text-muted-foreground">
          Every AI score includes the reasoning behind it — click it open. If the reasoning is wrong, flag it with a note. Flags get used to tune the prompts before the full tool ships.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-3">How to use</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>Paste an <strong>upstream</strong> course's syllabus (or click a sample button to load an example).</li>
          <li>Paste a <strong>downstream</strong> course's syllabus.</li>
          <li>Pick the career target you want to evaluate alignment against ({CAREER_TARGETS.length} options).</li>
          <li>Click <strong>Analyze</strong>. The analysis takes 30–60 seconds. Six AI calls run sequentially.</li>
          <li>Review the drafted KUD outcomes, the coverage heat map, and the prerequisite gap analysis. Click any reasoning to read it and flag if wrong.</li>
        </ol>
      </section>

      <PrototypeForm onAnalyze={handleAnalyze} isAnalyzing={analyzing} />

      {error && (
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">
          {error}
        </div>
      )}

      {result && target && (
        <section className="space-y-8">
          <Separator />
          <div className="grid md:grid-cols-2 gap-4">
            <KUDCard courseLabel={labels.up} kud={result.upstream.kud} />
            <KUDCard courseLabel={labels.down} kud={result.downstream.kud} />
          </div>
          <CoverageHeatMap
            target={target}
            upstreamLabel={labels.up}
            upstreamScores={result.upstream.coverage}
            downstreamLabel={labels.down}
            downstreamScores={result.downstream.coverage}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={target}
            gaps={result.downstream.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}.
          </footer>
        </section>
      )}

      <footer className="pt-12 border-t text-sm text-muted-foreground">
        This is a prototype. The full tool ships in ~3 months. Feedback: <a className="underline" href="mailto:chiptoe@mac.com">chiptoe@mac.com</a>.
      </footer>
    </main>
  );
}
```

- [ ] **Step 5: Modify analyze route to return the runId**

Edit `app/api/analyze/route.ts`. At the point where `insertRun` is called, capture its return value and merge into the response. Replace:

```ts
  await insertRun({
    ipHash: hashIp(req),
    ...
  });

  return NextResponse.json(result);
```

with:

```ts
  const { id: runId } = await insertRun({
    ipHash: hashIp(req),
    careerTargetId,
    upstreamCourseLabel: upstream.courseLabel ?? null,
    downstreamCourseLabel: downstream.courseLabel ?? null,
    upstreamSyllabus: upstream.syllabusText,
    downstreamSyllabus: downstream.syllabusText,
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totalCost,
    durationMs: result.meta.durationMs,
  });

  return NextResponse.json({ ...result, runId });
```

- [ ] **Step 6: Smoke test build**

Run: `pnpm build`
Expected: Build succeeds, no type errors.

- [ ] **Step 7: Smoke test locally**

Set `PROTOTYPE_SLUG=test-slug-1234` in `.env.local`, then:
```bash
pnpm dev
```
Open `http://localhost:3000/preview/test-slug-1234` — the page should render. With a real OPENAI_API_KEY set, clicking Analyze with the example syllabi should produce real results in 30–60 seconds.

Stop the dev server with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add app/ lib/slug.ts
git commit -m "feat: prototype page with intro, instructions, form, and output rendering"
```

---

## Task 15: Rate limit + daily cost cap

**Files:**
- Create: `lib/rate-limit/ip-rate-limit.ts`, `lib/rate-limit/daily-cap.ts`
- Modify: `app/api/analyze/route.ts` (apply both before AI calls)
- Create: `lib/db/schema.ts` additions (cost log table)
- Create: `tests/lib/rate-limit/ip-rate-limit.test.ts`

- [ ] **Step 1: Add a cost log table**

In `lib/db/schema.ts`, append:
```ts
export const dailyCost = pgTable('daily_cost', {
  day: text('day').primaryKey(),               // 'YYYY-MM-DD' UTC
  totalCostUsdCents: integer('total_cost_usd_cents').notNull().default(0),
  lastAlertSent: timestamp('last_alert_sent', { withTimezone: true }),
});

export const ipHourly = pgTable('ip_hourly', {
  ipHash: text('ip_hash').notNull(),
  hourKey: text('hour_key').notNull(),         // 'YYYY-MM-DDTHH' UTC
  count: integer('count').notNull().default(0),
}, (t) => ({
  pk: { columns: [t.ipHash, t.hourKey] },
}));
```

Note: The composite PK syntax above is a placeholder; use the actual Drizzle pattern, which is `primaryKey({ columns: [t.ipHash, t.hourKey] })`. Adjust the import: `import { pgTable, ..., primaryKey } from 'drizzle-orm/pg-core';` and replace the `(t) => ({ pk: ... })` block with `(t) => ({ pk: primaryKey({ columns: [t.ipHash, t.hourKey] }) })`.

- [ ] **Step 2: Generate and run migration**

```bash
pnpm db:generate
pnpm db:migrate
```
Expected: Two new tables on Neon.

- [ ] **Step 3: Write rate limit test**

Create `tests/lib/rate-limit/ip-rate-limit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} as any }));

const incrementSpy = vi.fn();
vi.mock('@/lib/rate-limit/ip-rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/ip-rate-limit')>('@/lib/rate-limit/ip-rate-limit');
  return { ...actual };
});

import { checkIpRateLimit, MAX_PER_HOUR } from '@/lib/rate-limit/ip-rate-limit';

describe('checkIpRateLimit', () => {
  beforeEach(() => incrementSpy.mockReset());

  it('exports a constant MAX_PER_HOUR of 10', () => {
    expect(MAX_PER_HOUR).toBe(10);
  });

  // Integration tests against the real DB run separately; this unit test just verifies the constant.
});
```

(Full integration tests for rate-limit run separately against a Neon test branch; for the prototype, a smoke test plus the constant check is enough.)

- [ ] **Step 4: Implement ip-rate-limit**

Create `lib/rate-limit/ip-rate-limit.ts`:
```ts
import { db } from '@/lib/db/client';
import { ipHourly } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const MAX_PER_HOUR = 10;

function currentHourKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
}

export async function checkIpRateLimit(ipHash: string): Promise<{ allowed: boolean; remaining: number }> {
  const hourKey = currentHourKey();
  const result = await db.execute(sql`
    INSERT INTO ip_hourly (ip_hash, hour_key, count)
    VALUES (${ipHash}, ${hourKey}, 1)
    ON CONFLICT (ip_hash, hour_key)
    DO UPDATE SET count = ip_hourly.count + 1
    RETURNING count
  `);
  const row = result.rows[0] as { count: number } | undefined;
  const count = row?.count ?? 1;
  return { allowed: count <= MAX_PER_HOUR, remaining: Math.max(0, MAX_PER_HOUR - count) };
}
```

- [ ] **Step 5: Implement daily cost cap**

Create `lib/rate-limit/daily-cap.ts`:
```ts
import { db } from '@/lib/db/client';
import { dailyCost } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

function currentDayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function capCents(): number {
  const usd = Number(process.env.DAILY_COST_CAP_USD ?? '5');
  return Math.floor(usd * 100 * 100);     // dollars → cents → 1/100 of a cent
}

export async function checkDailyCap(): Promise<{ ok: boolean; spentCents: number }> {
  const day = currentDayKey();
  const result = await db.execute(sql`
    SELECT COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost WHERE day = ${day}
  `);
  const spent = (result.rows[0] as { spent: number } | undefined)?.spent ?? 0;
  return { ok: spent < capCents(), spentCents: spent };
}

export async function recordSpend(costCents: number): Promise<void> {
  const day = currentDayKey();
  await db.execute(sql`
    INSERT INTO daily_cost (day, total_cost_usd_cents)
    VALUES (${day}, ${costCents})
    ON CONFLICT (day)
    DO UPDATE SET total_cost_usd_cents = daily_cost.total_cost_usd_cents + ${costCents}
  `);
}
```

- [ ] **Step 6: Wire rate limit + cap into the analyze route**

Edit `app/api/analyze/route.ts`. Near the top of the `POST` handler, after parsing the request and before calling the provider, add:

```ts
  // Rate limit + cost cap
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });
  }
```

Add at top of file:
```ts
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
```

Also remove the local `hashIp` helper (since we now call `hashIp` once at the top); move the `const ipHash = hashIp(req);` line above its first use and use the same variable when calling `insertRun`.

After the `insertRun` call and before returning, add:
```ts
  await recordSpend(totalCost);
```

- [ ] **Step 7: Build to verify wiring**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/rate-limit/ lib/db/schema.ts drizzle/ app/api/analyze/route.ts tests/lib/rate-limit/
git commit -m "feat: per-IP rate limit (10/hr) and daily cost cap ($5) on the analyze endpoint"
```

---

## Task 16: Deploy to Vercel

**Files:** (no code; infrastructure)

- [ ] **Step 1: Push to GitHub**

Run:
```bash
git push origin main
```

- [ ] **Step 2: Connect repo to Vercel**

Open https://vercel.com/new. Sign in with GitHub. Import `chiptoe-svg/gc-curriculum-tool`. Use default Next.js settings.

- [ ] **Step 3: Add environment variables in Vercel**

In Vercel project settings → Environment Variables, add (for Production and Preview both):
- `DATABASE_URL` (Neon pooled connection string)
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-4o`
- `AI_PROVIDER=openai`
- `PROTOTYPE_SLUG=<generate-a-fresh-unguessable-string-here>`
- `DAILY_COST_CAP_USD=5`
- `COST_ALERT_EMAIL=chiptoe@mac.com`

Generate a slug locally with:
```bash
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

- [ ] **Step 4: Trigger deploy**

In Vercel, click Deploy. Wait for the build (1–2 min). Note the production URL (e.g., `gc-curriculum-tool.vercel.app`).

- [ ] **Step 5: Smoke test deployed prototype**

Open `https://<project>.vercel.app/preview/<your-slug>` in a fresh browser tab (incognito to confirm no auth required). Verify:
1. Page loads with the hero copy and instructions
2. Sample syllabus buttons populate the textareas
3. Pick a career target, click Analyze
4. Wait ~30–60 seconds
5. KUD cards appear, heat map appears, prereq gap panel appears
6. Click "Show AI reasoning" on a cell — reasoning appears
7. Click "Flag this reasoning" — dialog opens, submit a test flag
8. Reload the page; the flag should be visible in Neon (`SELECT * FROM prototype_flags`).

If any step fails, debug locally with `pnpm dev` and the same env vars, then redeploy.

- [ ] **Step 6: Update README with the live link**

Edit `README.md`. Replace the "Status" section's contents with:

```markdown
## Status

**M-trial (faculty prototype) deployed.** Live at the unguessable preview URL — get it from Chip.

- Source spec: [`gc-curriculum-tool-spec.md`](./gc-curriculum-tool-spec.md)
- v1 design: [`docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.md`](./docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-17-m-trial-prototype.md`](./docs/superpowers/plans/2026-05-17-m-trial-prototype.md)
```

- [ ] **Step 7: Commit and push**

```bash
git add README.md
git commit -m "docs: link to live prototype and implementation plan"
git push origin main
```

---

## Task 17: Self-check + faculty rollout

- [ ] **Step 1: Run the full test suite one more time**

Run: `pnpm test`
Expected: Every test in the suite passes.

- [ ] **Step 2: Validate the gate**

The M-trial gate from the v1 design doc:
> A faculty member you've never demoed it to can open the link, follow the instructions, paste their own syllabus, get a result they find substantive enough to argue with, and flag at least one piece of AI reasoning.

To validate:
1. Send the preview URL to one faculty member you trust to push back honestly (not a fan-mode person).
2. Ask them to use it cold — no demo, no walkthrough.
3. After 24–48 hours, query the flags:
   ```sql
   SELECT * FROM prototype_flags ORDER BY created_at DESC;
   SELECT * FROM prototype_runs ORDER BY created_at DESC LIMIT 5;
   ```
4. If there are flags, the gate is met. If there are no flags but they did run analyses, the AI may be too cautious or too vague — read the runs and decide whether to iterate prompts or expand the trial.

- [ ] **Step 3: Iterate prompts based on flags**

For each flag:
1. Read the run's stored `result` jsonb to see the exact AI reasoning that was flagged.
2. Read the faculty note for what specifically was wrong.
3. Modify the relevant prompt file (`lib/ai/prompts/<name>.md`) to address the failure mode.
4. Redeploy. (Vercel auto-deploys on push.)
5. Optionally re-analyze the same syllabus pair through the prototype to confirm the change had the intended effect.

This loop is the actual deliverable of M-trial: a tuned, faculty-validated prompt set ready for M0–M3.

- [ ] **Step 4: Trigger the next planning round**

Once the gate is met and at least 3 distinct faculty pushback flags have been incorporated into prompt revisions, the M-trial is complete. The next session should run the writing-plans skill on the M0–M3 portion of the v1 design doc, informed by what M-trial taught.

---

## Spec Coverage Check

Mapping each requirement in the v1 design's M-trial section to a task in this plan:

| Spec requirement (from M-trial section) | Task that implements it |
|---|---|
| Next.js page at root with intro/instructions/form/output | Task 14 |
| Hero + bigger-picture intro (~200–300 words) | Task 14 step 4 |
| Step-by-step instructions | Task 14 step 4 |
| Two syllabus textareas with "Load example" buttons | Task 12 |
| Career target dropdown | Task 12 |
| Analyze button | Task 12 |
| Two side-by-side KUD outcome cards | Tasks 13, 14 |
| Heat map: 2 rows × N columns by KUD level | Task 13 |
| Click cell → expand reasoning + Flag button | Tasks 13, 14 |
| Prerequisite Gap Analysis panel | Tasks 13, 14 |
| Footer with feedback email | Task 14 |
| AI provider abstraction (carries forward) | Task 6 |
| Manning-skill-encoded prompts (carries forward) | Task 7 |
| Seed data: 5 targets + sub-competencies + KUD (carries forward) | Task 4 |
| Heat map + gap components (carry forward) | Task 13 |
| `prototype_runs` + `prototype_flags` log tables | Tasks 2, 9 |
| Per-IP rate limit (10/hour) | Task 15 |
| Daily cost cap ($5) | Task 15 |
| Unguessable URL: `/preview/<slug>` | Task 14 |
| Sample syllabi for GC 3460, 4060, 4070, 4400, 3720, 3400 | Task 5 |
| Access model: unguessable URL, no password | Task 14 |
| Gate: faculty can use cold and flag | Task 17 |

All M-trial requirements covered.
