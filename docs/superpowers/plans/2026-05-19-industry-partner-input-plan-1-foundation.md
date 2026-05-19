# Industry Partner Input — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working magic-link partner-survey tool that faculty can pilot with 5–10 partners. Covers spec build phases 1–3: partners table + CSV import + invite email, magic-link auth + partner dashboard shell, and position-submission flow A (draft + submit).

**Architecture:** Same Next.js app as the curriculum tool. New `/partners/[token]/...` route group is the partner-facing surface; new `/admin/partners` page is the faculty surface. Three new Drizzle tables in Phase 1 (`partners`, `partner_sessions`, `partner_events`), one more in Phase 3 (`partner_submissions`). Magic token is a 32-char URL-safe random string that bears identity. Session cookie is a 24h httpOnly secondary credential — token in URL works as a fallback so bookmarks survive cookie expiry. Email via Resend.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, Vitest, @base-ui/react primitives, Tailwind v4, Resend (new dep), @react-email/components (new dep). Package manager: pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-18-industry-partner-input-design.md`](../specs/2026-05-18-industry-partner-input-design.md).

---

## File Structure

**New files (created by this plan):**

```
lib/
  partners/
    tokens.ts                          # magic-token + session-id generation
    sessions.ts                        # session cookie helpers (create, read, revoke)
    auth.ts                            # request → partner resolver (token-or-cookie)
    csv.ts                             # CSV parsing + validation for partner import
    queries.ts                         # Drizzle queries for partners/sessions/events
  email/
    resend.ts                          # lazy Resend client wrapper
    send-partner-invite.ts             # send invite email function
    templates/
      partner-invite.tsx               # React Email template
  rate-limit/
    partner-rate-limit.ts              # per-partner rate-limit (writes/day buckets)

app/
  partners/
    [token]/
      layout.tsx                       # partner shell — own header/branding
      page.tsx                         # welcome OR dashboard, branches on activity
      welcome/
        WelcomeScreen.tsx              # ↑ used by page.tsx for first-time view
      dashboard/
        PartnerDashboard.tsx           # ↑ used by page.tsx once activity exists
      submit/
        page.tsx                       # submission wizard shell (Steps 1–3)
        CareerTargetPicker.tsx         # Step 1
        PositionForm.tsx               # Step 2
        SubmissionConfirmation.tsx     # Step 3
  admin/
    partners/
      page.tsx                         # admin partners table + import CTA
      PartnersTable.tsx                # client component
      ImportCsvDialog.tsx              # CSV upload + preview + confirm
  api/
    admin/
      partners/
        route.ts                       # GET list, POST create-one
        import/
          route.ts                     # POST CSV bulk import
        [partnerId]/
          route.ts                     # PATCH (edit), DELETE (deactivate)
          resend-invite/
            route.ts                   # POST resend invite email
    partners/
      me/
        route.ts                       # GET partner identity + counts
      submissions/
        route.ts                       # GET list, POST create draft
        [submissionId]/
          route.ts                     # GET one, PATCH, POST :submit, DELETE
      target-options/
        route.ts                       # GET career targets for picker

drizzle/
  0005_<auto>.sql                      # partners + partner_sessions + partner_events
  0006_<auto>.sql                      # partner_submissions

tests/
  partners/
    tokens.test.ts
    csv.test.ts
    sessions.test.ts
    auth.test.ts
  email/
    send-partner-invite.test.ts
  api/
    admin-partners-import.test.ts
    partners-submissions.test.ts
```

**Modified files:**

- `lib/db/schema.ts` — append `partners`, `partner_sessions`, `partner_events` (T1) and `partner_submissions` (T15).
- `.env.example` — add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PARTNERS_BASE_URL`.
- `package.json` — add `resend`, `@react-email/components`, `papaparse` deps (T3, T4).

---

# Phase 1 — Partners table + CSV import + invite email

### Task 1: Add `partners`, `partner_sessions`, `partner_events` to Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0005_<auto>.sql`
- Test: `lib/db/__tests__/partner-schema.test.ts` (create)

- [ ] **Step 1: Append three table definitions to `lib/db/schema.ts`**

After the existing `sheetSyncState` table at the end of the file, add:

```typescript
export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  company: text('company').notNull(),
  roleTitle: text('role_title'),
  weight: integer('weight').notNull().default(1),
  careerTargetHints: jsonb('career_target_hints').$type<string[]>().notNull().default([]),
  magicToken: text('magic_token').notNull().unique(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

export const partnerSessions = pgTable('partner_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const partnerEvents = pgTable('partner_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`

Expected: a new file `drizzle/0005_*.sql` appears containing `CREATE TABLE partners`, `CREATE TABLE partner_sessions`, `CREATE TABLE partner_events`.

- [ ] **Step 3: Write schema smoke test**

Create `lib/db/__tests__/partner-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { partners, partnerSessions, partnerEvents } from '@/lib/db/schema';

describe('partner schema', () => {
  it('partners has expected columns', () => {
    const cols = Object.keys(partners);
    for (const c of ['id', 'email', 'firstName', 'lastName', 'company', 'roleTitle',
                     'weight', 'careerTargetHints', 'magicToken', 'tokenExpiresAt',
                     'notes', 'createdAt', 'invitedAt', 'firstOpenedAt',
                     'lastActiveAt', 'active']) {
      expect(cols).toContain(c);
    }
  });

  it('partnerSessions has expected columns', () => {
    const cols = Object.keys(partnerSessions);
    for (const c of ['id', 'partnerId', 'createdAt', 'expiresAt']) {
      expect(cols).toContain(c);
    }
  });

  it('partnerEvents has expected columns', () => {
    const cols = Object.keys(partnerEvents);
    for (const c of ['id', 'partnerId', 'eventType', 'metadata', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 4: Run schema test**

Run: `pnpm test lib/db/__tests__/partner-schema.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Apply migration to local DB**

Run: `pnpm db:migrate`
Expected: migration applied without error.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/0005_*.sql lib/db/__tests__/partner-schema.test.ts
git commit -m "feat(db): add partners, partner_sessions, partner_events tables"
```

---

### Task 2: Magic-token + session-id utilities

**Files:**
- Create: `lib/partners/tokens.ts`
- Test: `tests/partners/tokens.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/partners/tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateMagicToken, generateSessionId, TOKEN_LENGTH } from '@/lib/partners/tokens';

describe('generateMagicToken', () => {
  it('returns a 32-char URL-safe string', () => {
    const t = generateMagicToken();
    expect(t).toHaveLength(TOKEN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a different value each call', () => {
    const a = generateMagicToken();
    const b = generateMagicToken();
    expect(a).not.toBe(b);
  });
});

describe('generateSessionId', () => {
  it('returns a UUID-like string', () => {
    const s = generateSessionId();
    expect(s).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/partners/tokens.test.ts`
Expected: FAIL with "Cannot find module '@/lib/partners/tokens'".

- [ ] **Step 3: Implement the utility**

Create `lib/partners/tokens.ts`:

```typescript
import { randomBytes, randomUUID } from 'node:crypto';

export const TOKEN_LENGTH = 32;

/**
 * 32-char URL-safe random token. base64url of 24 random bytes = 32 chars.
 * Cryptographic RNG. Never log raw tokens.
 */
export function generateMagicToken(): string {
  return randomBytes(24).toString('base64url');
}

export function generateSessionId(): string {
  return randomUUID();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/partners/tokens.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/partners/tokens.ts tests/partners/tokens.test.ts
git commit -m "feat(partners): magic-token and session-id generators"
```

---

### Task 3: Resend client + invite email template

**Files:**
- Modify: `package.json` (add `resend`, `@react-email/components`)
- Create: `lib/email/resend.ts`
- Create: `lib/email/templates/partner-invite.tsx`
- Create: `lib/email/send-partner-invite.ts`
- Modify: `.env.example`
- Test: `tests/email/send-partner-invite.test.ts` (create)

- [ ] **Step 1: Install email dependencies**

Run: `pnpm add resend @react-email/components`
Expected: deps appear in `package.json`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:

```bash
# Resend (transactional email for partner invites)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=GC Curriculum <no-reply@example.com>

# Base URL used in partner magic-link emails (no trailing slash)
PARTNERS_BASE_URL=https://gc-curriculum-tool.vercel.app
```

- [ ] **Step 3: Create lazy Resend client wrapper**

Create `lib/email/resend.ts`:

```typescript
import { Resend } from 'resend';

let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('RESEND_API_KEY not set');
  cached = new Resend(key);
  return cached;
}

export function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) throw new Error('RESEND_FROM_EMAIL not set');
  return from;
}

export function getPartnersBaseUrl(): string {
  const url = process.env.PARTNERS_BASE_URL?.trim();
  if (!url) throw new Error('PARTNERS_BASE_URL not set');
  return url.replace(/\/$/, '');
}
```

- [ ] **Step 4: Create invite email template**

Create `lib/email/templates/partner-invite.tsx`:

```tsx
import { Html, Head, Body, Container, Heading, Text, Button, Hr, Section } from '@react-email/components';

export interface PartnerInviteProps {
  firstName: string;
  magicUrl: string;
}

export function PartnerInvite({ firstName, magicUrl }: PartnerInviteProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#f8fafc', padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: 560, borderRadius: 8 }}>
          <Heading as="h1" style={{ fontSize: 22, margin: 0 }}>
            Help us shape what GC graduates can do
          </Heading>
          <Text>Hi {firstName},</Text>
          <Text>
            Clemson Graphic Communications is updating the career targets our curriculum builds toward, and
            we'd like your input. Tell us about the roles you hire GC grads into — job title, responsibilities,
            salary range, the skills you actually look for. You can describe as many positions as you want, and
            you can stop and come back anytime through the same link.
          </Text>
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button
              href={magicUrl}
              style={{ backgroundColor: '#1e293b', color: '#ffffff', padding: '12px 20px', borderRadius: 6, fontSize: 15, textDecoration: 'none' }}
            >
              Open the survey
            </Button>
          </Section>
          <Text style={{ fontSize: 13, color: '#475569' }}>
            About 10 minutes per position you describe. Optional 5 minutes to rate the student projects you'd
            want grads to have done.
          </Text>
          <Hr />
          <Text style={{ fontSize: 12, color: '#64748b' }}>
            This link is unique to you. Please don't share it. If you weren't expecting this email, reply and
            let us know.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Write the failing test for send-partner-invite**

Create `tests/email/send-partner-invite.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Resend client BEFORE importing the module under test.
const send = vi.fn();
vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({ emails: { send } }),
  getFromEmail: () => 'GC Curriculum <no-reply@example.com>',
  getPartnersBaseUrl: () => 'https://example.test',
}));

import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
});

describe('sendPartnerInvite', () => {
  it('sends with rendered HTML containing the magic URL', async () => {
    await sendPartnerInvite({ firstName: 'Alex', email: 'alex@acme.test', token: 'TOKEN123' });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe('alex@acme.test');
    expect(arg.from).toBe('GC Curriculum <no-reply@example.com>');
    expect(arg.subject).toMatch(/Clemson/i);
    expect(arg.html).toContain('https://example.test/partners/TOKEN123');
    expect(arg.html).toContain('Alex');
  });

  it('throws when Resend returns an error', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'rejected' } });
    await expect(
      sendPartnerInvite({ firstName: 'Alex', email: 'alex@acme.test', token: 'TOKEN123' }),
    ).rejects.toThrow(/rejected/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/email/send-partner-invite.test.ts`
Expected: FAIL with "Cannot find module '@/lib/email/send-partner-invite'".

- [ ] **Step 7: Implement sendPartnerInvite**

Create `lib/email/send-partner-invite.ts`:

```typescript
import { render } from '@react-email/components';
import { getResend, getFromEmail, getPartnersBaseUrl } from './resend';
import { PartnerInvite } from './templates/partner-invite';

export interface SendPartnerInviteArgs {
  firstName: string;
  email: string;
  token: string;
}

export async function sendPartnerInvite({ firstName, email, token }: SendPartnerInviteArgs) {
  const magicUrl = `${getPartnersBaseUrl()}/partners/${token}`;
  const html = await render(<PartnerInvite firstName={firstName} magicUrl={magicUrl} />);
  const { error } = await getResend().emails.send({
    from: getFromEmail(),
    to: email,
    subject: 'Help shape the Clemson GC curriculum — quick survey',
    html,
  });
  if (error) throw new Error(`Resend rejected invite for ${email}: ${error.message}`);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test tests/email/send-partner-invite.test.ts`
Expected: 2 passing tests.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example lib/email tests/email/send-partner-invite.test.ts
git commit -m "feat(email): Resend client + partner invite template"
```

---

### Task 4: CSV parser + validator for partner import

**Files:**
- Modify: `package.json` (add `papaparse` + types)
- Create: `lib/partners/csv.ts`
- Test: `tests/partners/csv.test.ts` (create)

- [ ] **Step 1: Install CSV parser**

Run: `pnpm add papaparse && pnpm add -D @types/papaparse`
Expected: deps appear in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `tests/partners/csv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePartnersCsv } from '@/lib/partners/csv';

const HEADER = 'email,firstName,lastName,company,roleTitle,weight,careerTargetHints';

describe('parsePartnersCsv', () => {
  it('parses a valid row', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme Print,Plant Manager,3,production-operations`;
    const result = parsePartnersCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      email: 'alex@acme.test',
      firstName: 'Alex',
      lastName: 'Jordan',
      company: 'Acme Print',
      roleTitle: 'Plant Manager',
      weight: 3,
      careerTargetHints: ['production-operations'],
    });
  });

  it('defaults missing weight to 1 and missing roleTitle to null', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme,,,`;
    const { rows, errors } = parsePartnersCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].weight).toBe(1);
    expect(rows[0].roleTitle).toBeNull();
    expect(rows[0].careerTargetHints).toEqual([]);
  });

  it('parses multiple careerTargetHints separated by pipe', () => {
    const csv = `${HEADER}\nalex@acme.test,Alex,Jordan,Acme,,1,production-operations|workflow-management`;
    const { rows } = parsePartnersCsv(csv);
    expect(rows[0].careerTargetHints).toEqual(['production-operations', 'workflow-management']);
  });

  it('reports per-row errors with row numbers and continues parsing', () => {
    const csv = [
      HEADER,
      'not-an-email,Alex,J,Acme,,1,',
      'beth@acme.test,Beth,Smith,Acme,,1,',
      ',Carl,Diaz,Acme,,1,',
    ].join('\n');
    const { rows, errors } = parsePartnersCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('beth@acme.test');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 2 });
    expect(errors[0].message).toMatch(/email/i);
    expect(errors[1]).toMatchObject({ row: 4 });
    expect(errors[1].message).toMatch(/email/i);
  });

  it('rejects unknown headers and missing required headers', () => {
    const result1 = parsePartnersCsv('email,firstName\nalex@acme.test,Alex');
    expect(result1.errors[0].message).toMatch(/missing header/i);

    const result2 = parsePartnersCsv(`${HEADER},extraCol\nalex@acme.test,Alex,Jordan,Acme,,1,,oops`);
    expect(result2.errors.some(e => /unknown header/i.test(e.message))).toBe(true);
  });

  it('strips UTF-8 BOM and trims whitespace from cells', () => {
    const csv = `﻿${HEADER}\n  alex@acme.test ,  Alex  ,Jordan,Acme,,1,`;
    const { rows, errors } = parsePartnersCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].email).toBe('alex@acme.test');
    expect(rows[0].firstName).toBe('Alex');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/partners/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement parsePartnersCsv**

Create `lib/partners/csv.ts`:

```typescript
import Papa from 'papaparse';

export interface PartnerCsvRow {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  roleTitle: string | null;
  weight: number;
  careerTargetHints: string[];
}

export interface PartnerCsvError {
  row: number; // 1-indexed, header row = 1, first data row = 2
  message: string;
}

export interface PartnerCsvResult {
  rows: PartnerCsvRow[];
  errors: PartnerCsvError[];
}

const REQUIRED_HEADERS = ['email', 'firstName', 'lastName', 'company', 'roleTitle', 'weight', 'careerTargetHints'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePartnersCsv(input: string): PartnerCsvResult {
  // Strip BOM if present.
  const clean = input.replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: true });
  const errors: PartnerCsvError[] = [];

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      errors.push({ row: (e.row ?? 0) + 1, message: e.message });
    }
  }

  const allRows = parsed.data;
  if (allRows.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'CSV is empty' }] };
  }

  const headers = allRows[0].map(h => h.trim());
  // Missing required headers
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      errors.push({ row: 1, message: `Missing header: ${required}` });
    }
  }
  // Unknown headers
  for (const h of headers) {
    if (!(REQUIRED_HEADERS as readonly string[]).includes(h)) {
      errors.push({ row: 1, message: `Unknown header: ${h}` });
    }
  }
  if (errors.some(e => e.row === 1)) {
    return { rows: [], errors };
  }

  const index = (name: string) => headers.indexOf(name);
  const rows: PartnerCsvRow[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const raw = allRows[i].map(c => (c ?? '').trim());
    const rowNum = i + 1;
    const email = raw[index('email')];
    if (!email) {
      errors.push({ row: rowNum, message: 'email is required' });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row: rowNum, message: `email "${email}" is invalid` });
      continue;
    }
    const firstName = raw[index('firstName')];
    const lastName = raw[index('lastName')];
    const company = raw[index('company')];
    if (!firstName || !lastName || !company) {
      errors.push({ row: rowNum, message: 'firstName, lastName, and company are required' });
      continue;
    }
    const roleTitleRaw = raw[index('roleTitle')];
    const weightRaw = raw[index('weight')];
    const hintsRaw = raw[index('careerTargetHints')];
    let weight = 1;
    if (weightRaw) {
      const n = Number.parseInt(weightRaw, 10);
      if (Number.isNaN(n) || n < 0 || n > 10) {
        errors.push({ row: rowNum, message: `weight "${weightRaw}" must be an integer 0-10` });
        continue;
      }
      weight = n;
    }
    const careerTargetHints = hintsRaw
      ? hintsRaw.split('|').map(s => s.trim()).filter(Boolean)
      : [];

    rows.push({
      email,
      firstName,
      lastName,
      company,
      roleTitle: roleTitleRaw || null,
      weight,
      careerTargetHints,
    });
  }

  return { rows, errors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/partners/csv.test.ts`
Expected: 6 passing tests.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/partners/csv.ts tests/partners/csv.test.ts
git commit -m "feat(partners): CSV parser with per-row validation"
```

---

### Task 5: Partner queries module + admin-import endpoint

**Files:**
- Create: `lib/partners/queries.ts`
- Create: `app/api/admin/partners/route.ts`
- Create: `app/api/admin/partners/import/route.ts`
- Test: `tests/api/admin-partners-import.test.ts` (create)

- [ ] **Step 1: Create the queries module**

Create `lib/partners/queries.ts`:

```typescript
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners, partnerEvents } from '@/lib/db/schema';
import { generateMagicToken } from './tokens';

export interface CreatePartnerInput {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  roleTitle: string | null;
  weight: number;
  careerTargetHints: string[];
}

export async function createPartner(input: CreatePartnerInput) {
  const token = generateMagicToken();
  const [row] = await db.insert(partners).values({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    roleTitle: input.roleTitle,
    weight: input.weight,
    careerTargetHints: input.careerTargetHints,
    magicToken: token,
  }).returning();
  return row;
}

export async function findPartnerByEmail(email: string) {
  const rows = await db.select().from(partners).where(eq(partners.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findPartnerByToken(token: string) {
  const rows = await db.select().from(partners).where(eq(partners.magicToken, token)).limit(1);
  return rows[0] ?? null;
}

export async function findPartnerById(id: string) {
  const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listPartners() {
  return db.select().from(partners).orderBy(desc(partners.createdAt));
}

export async function markInvited(id: string) {
  await db.update(partners).set({ invitedAt: sql`now()` }).where(eq(partners.id, id));
}

export async function logPartnerEvent(
  partnerId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(partnerEvents).values({ partnerId, eventType, metadata });
}
```

- [ ] **Step 2: Write the failing test for the import endpoint**

Create `tests/api/admin-partners-import.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('@/lib/email/send-partner-invite', () => ({
  sendPartnerInvite: send,
}));

const createPartner = vi.fn();
const findPartnerByEmail = vi.fn();
const markInvited = vi.fn();
const logPartnerEvent = vi.fn();
vi.mock('@/lib/partners/queries', () => ({
  createPartner,
  findPartnerByEmail,
  markInvited,
  logPartnerEvent,
}));

vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'valid-slug-12345',
}));

import { POST } from '@/app/api/admin/partners/import/route';

beforeEach(() => {
  send.mockReset(); send.mockResolvedValue(undefined);
  createPartner.mockReset();
  findPartnerByEmail.mockReset(); findPartnerByEmail.mockResolvedValue(null);
  markInvited.mockReset(); markInvited.mockResolvedValue(undefined);
  logPartnerEvent.mockReset(); logPartnerEvent.mockResolvedValue(undefined);
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/partners/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/partners/import', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'wrong', csv: 'x' }));
    expect(res.status).toBe(401);
  });

  it('inserts new partners and sends invites', async () => {
    let n = 0;
    createPartner.mockImplementation(async (input) => ({
      id: `id-${++n}`, ...input, magicToken: `tok-${n}`,
    }));
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
      'b@acme.test,B,Two,Acme,,2,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ inserted: 2, skipped: 0, errors: [] });
    expect(createPartner).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(markInvited).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate emails without sending', async () => {
    findPartnerByEmail.mockResolvedValueOnce({ id: 'existing-id', email: 'a@acme.test' });
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(0);
    expect(json.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 400 with errors on CSV validation failure', async () => {
    const csv = 'email,firstName\na@acme.test,A';
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it('continues after a single send failure and reports it', async () => {
    let n = 0;
    createPartner.mockImplementation(async (input) => ({ id: `id-${++n}`, ...input, magicToken: `tok-${n}` }));
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
      'b@acme.test,B,Two,Acme,,1,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    const json = await res.json();
    expect(json.inserted).toBe(2);
    expect(json.sendFailures).toEqual([{ email: 'b@acme.test', message: 'boom' }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/api/admin-partners-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the import endpoint**

Create `app/api/admin/partners/import/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { parsePartnersCsv } from '@/lib/partners/csv';
import { createPartner, findPartnerByEmail, markInvited, logPartnerEvent } from '@/lib/partners/queries';
import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv) {
    return NextResponse.json({ error: 'csv body required' }, { status: 400 });
  }

  const parsed = parsePartnersCsv(csv);
  if (parsed.errors.length > 0 && parsed.rows.length === 0) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  let inserted = 0;
  let skipped = 0;
  const sendFailures: Array<{ email: string; message: string }> = [];

  for (const row of parsed.rows) {
    const existing = await findPartnerByEmail(row.email);
    if (existing) {
      skipped++;
      continue;
    }
    const created = await createPartner(row);
    inserted++;
    try {
      await sendPartnerInvite({
        firstName: created.firstName,
        email: created.email,
        token: created.magicToken,
      });
      await markInvited(created.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendFailures.push({ email: created.email, message: msg });
    }
  }

  await logPartnerEvent(null, 'admin_imported_csv', {
    inserted, skipped,
    rowErrors: parsed.errors,
    sendFailures,
  });

  return NextResponse.json({
    inserted,
    skipped,
    errors: parsed.errors,
    sendFailures,
  });
}
```

- [ ] **Step 5: Create the parent partners route stub**

Create `app/api/admin/partners/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listPartners } from '@/lib/partners/queries';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const rows = await listPartners();
  // Strip magicToken — never expose tokens in the list view.
  const safe = rows.map(({ magicToken, ...rest }) => rest);
  return NextResponse.json({ partners: safe });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/api/admin-partners-import.test.ts`
Expected: 5 passing tests.

- [ ] **Step 7: Commit**

```bash
git add lib/partners/queries.ts app/api/admin/partners tests/api/admin-partners-import.test.ts
git commit -m "feat(api): admin partners CSV import + list endpoint"
```

---

### Task 6: Admin partners page (table + import dialog)

**Files:**
- Create: `app/admin/partners/page.tsx`
- Create: `app/admin/partners/PartnersTable.tsx`
- Create: `app/admin/partners/ImportCsvDialog.tsx`

- [ ] **Step 1: Create the server page**

Create `app/admin/partners/page.tsx`:

```tsx
import { listPartners } from '@/lib/partners/queries';
import { PartnersTable } from './PartnersTable';
import { ImportCsvDialog } from './ImportCsvDialog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPartnersPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  const raw = await listPartners();
  // Strip magicToken; convert Date columns to ISO strings so they cross the
  // server→client component boundary cleanly and match PartnersTable's prop type.
  const partners = raw.map(({ magicToken, ...rest }) => ({
    ...rest,
    invitedAt: rest.invitedAt ? rest.invitedAt.toISOString() : null,
    lastActiveAt: rest.lastActiveAt ? rest.lastActiveAt.toISOString() : null,
    firstOpenedAt: rest.firstOpenedAt ? rest.firstOpenedAt.toISOString() : null,
    createdAt: rest.createdAt.toISOString(),
    tokenExpiresAt: rest.tokenExpiresAt ? rest.tokenExpiresAt.toISOString() : null,
  }));

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Industry partners</h1>
          <p className="text-sm text-slate-600">{partners.length} on file.</p>
        </div>
        <ImportCsvDialog slug={slug} />
      </header>
      <PartnersTable partners={partners} slug={slug} />
    </main>
  );
}
```

- [ ] **Step 2: Create the table client component**

Create `app/admin/partners/PartnersTable.tsx`:

```tsx
'use client';

import { useTransition } from 'react';

export interface AdminPartnerRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  weight: number;
  invitedAt: string | null;
  lastActiveAt: string | null;
  active: boolean;
}

export function PartnersTable({ partners, slug }: { partners: AdminPartnerRow[]; slug: string }) {
  const [pending, start] = useTransition();

  async function resend(id: string) {
    start(async () => {
      const res = await fetch(`/api/admin/partners/${id}/resend-invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) alert(`Resend failed: ${res.status}`);
      else alert('Invite re-sent.');
    });
  }

  if (partners.length === 0) {
    return <p className="text-sm text-slate-500">No partners yet. Import a CSV to invite the first batch.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="text-left text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2">Name</th>
          <th>Company</th>
          <th>Weight</th>
          <th>Invited</th>
          <th>Last active</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {partners.map(p => (
          <tr key={p.id} className="border-t border-slate-200">
            <td className="py-2">{p.firstName} {p.lastName}<div className="text-xs text-slate-500">{p.email}</div></td>
            <td>{p.company}</td>
            <td>{p.weight}</td>
            <td className="text-xs">{p.invitedAt ? new Date(p.invitedAt).toLocaleDateString() : '—'}</td>
            <td className="text-xs">{p.lastActiveAt ? new Date(p.lastActiveAt).toLocaleDateString() : '—'}</td>
            <td>{p.active ? <span className="text-green-700">active</span> : <span className="text-slate-500">off</span>}</td>
            <td>
              <button
                onClick={() => resend(p.id)}
                disabled={pending}
                className="text-xs text-blue-700 hover:underline disabled:opacity-50"
              >
                Resend invite
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create the import dialog**

Create `app/admin/partners/ImportCsvDialog.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

export function ImportCsvDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<null | { inserted: number; skipped: number; errors: { row: number; message: string }[]; sendFailures?: { email: string; message: string }[] }>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
  }

  function submit() {
    start(async () => {
      const res = await fetch('/api/admin/partners/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, csv }),
      });
      const json = await res.json();
      setResult(json);
      if (res.ok) window.location.reload();
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded bg-slate-800 px-4 py-2 text-sm text-white">
        Import CSV
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl space-y-4 rounded bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import partners from CSV</h2>
          <button onClick={() => { setOpen(false); setCsv(''); setResult(null); }} className="text-slate-500">✕</button>
        </div>
        <p className="text-xs text-slate-600">
          Required columns: <code>email,firstName,lastName,company,roleTitle,weight,careerTargetHints</code>.
          weight defaults to 1; multiple careerTargetHints separated by <code>|</code>.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {csv && (
          <textarea
            className="h-40 w-full rounded border border-slate-300 p-2 font-mono text-xs"
            value={csv}
            readOnly
          />
        )}
        {result && (
          <div className="rounded border border-slate-200 p-3 text-sm">
            <p>Inserted: <strong>{result.inserted}</strong> · Skipped duplicates: <strong>{result.skipped}</strong></p>
            {result.errors.length > 0 && (
              <div className="mt-2 text-red-700">
                <p>Row errors:</p>
                <ul className="ml-4 list-disc">{result.errors.map((e, i) => <li key={i}>row {e.row}: {e.message}</li>)}</ul>
              </div>
            )}
            {result.sendFailures && result.sendFailures.length > 0 && (
              <div className="mt-2 text-amber-700">
                <p>Send failures:</p>
                <ul className="ml-4 list-disc">{result.sendFailures.map((f, i) => <li key={i}>{f.email}: {f.message}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => { setCsv(''); setResult(null); }} className="text-sm text-slate-600">Clear</button>
          <button
            onClick={submit}
            disabled={!csv || pending}
            className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? 'Importing…' : 'Import + send invites'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

In the browser, visit `http://localhost:3000/admin/partners?slug=<your-PROTOTYPE_SLUG>`. Confirm the page renders an empty state. (Full import test happens in Task 7 once resend endpoint exists.)

- [ ] **Step 5: Commit**

```bash
git add app/admin/partners
git commit -m "feat(admin): partners page with CSV import dialog"
```

---

### Task 7: Resend-invite endpoint

**Files:**
- Create: `app/api/admin/partners/[partnerId]/resend-invite/route.ts`
- Test: `tests/api/admin-partners-resend.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin-partners-resend.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('@/lib/email/send-partner-invite', () => ({ sendPartnerInvite: send }));

const findPartnerById = vi.fn();
const markInvited = vi.fn();
const logPartnerEvent = vi.fn();
vi.mock('@/lib/partners/queries', () => ({
  findPartnerById, markInvited, logPartnerEvent,
}));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { POST } from '@/app/api/admin/partners/[partnerId]/resend-invite/route';

beforeEach(() => {
  send.mockReset(); send.mockResolvedValue(undefined);
  findPartnerById.mockReset();
  markInvited.mockReset(); markInvited.mockResolvedValue(undefined);
  logPartnerEvent.mockReset(); logPartnerEvent.mockResolvedValue(undefined);
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/partners/abc/resend-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/partners/[partnerId]/resend-invite', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'nope' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(401);
  });

  it('404s when partner not found', async () => {
    findPartnerById.mockResolvedValue(null);
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(404);
  });

  it('sends invite and updates invitedAt', async () => {
    findPartnerById.mockResolvedValue({
      id: 'abc', firstName: 'A', email: 'a@acme.test', magicToken: 'tok', active: true,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ firstName: 'A', email: 'a@acme.test', token: 'tok' });
    expect(markInvited).toHaveBeenCalledWith('abc');
    expect(logPartnerEvent).toHaveBeenCalledWith('abc', 'admin_resent_invite', expect.any(Object));
  });

  it('refuses to send for deactivated partners', async () => {
    findPartnerById.mockResolvedValue({
      id: 'abc', firstName: 'A', email: 'a@acme.test', magicToken: 'tok', active: false,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/admin-partners-resend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `app/api/admin/partners/[partnerId]/resend-invite/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { findPartnerById, markInvited, logPartnerEvent } from '@/lib/partners/queries';
import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

interface RouteContext {
  params: Promise<{ partnerId: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  const body = await req.json().catch(() => ({}));
  if (!isValidSlug(typeof body.slug === 'string' ? body.slug : '')) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const { partnerId } = await params;
  const partner = await findPartnerById(partnerId);
  if (!partner) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!partner.active) return NextResponse.json({ error: 'partner is deactivated' }, { status: 409 });

  await sendPartnerInvite({
    firstName: partner.firstName,
    email: partner.email,
    token: partner.magicToken,
  });
  await markInvited(partner.id);
  await logPartnerEvent(partner.id, 'admin_resent_invite', { at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/api/admin-partners-resend.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/partners/[partnerId] tests/api/admin-partners-resend.test.ts
git commit -m "feat(api): resend-invite endpoint for individual partners"
```

---

# Phase 2 — Magic-link auth + partner dashboard shell

### Task 8: Session helpers + auth resolver

**Files:**
- Create: `lib/partners/sessions.ts`
- Create: `lib/partners/auth.ts`
- Test: `tests/partners/sessions.test.ts` (create)
- Test: `tests/partners/auth.test.ts` (create)

- [ ] **Step 1: Write the failing test for sessions**

Create `tests/partners/sessions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertReturning = vi.fn();
const selectLimit = vi.fn();
const deleteWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    delete: () => ({ where: deleteWhere }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ partnerSessions: {} }));

import { createSession, lookupSession, revokeSession, SESSION_TTL_MS } from '@/lib/partners/sessions';

beforeEach(() => {
  insertReturning.mockReset();
  selectLimit.mockReset();
  deleteWhere.mockReset().mockResolvedValue(undefined);
});

describe('session helpers', () => {
  it('createSession returns id + expiresAt ~24h in future', async () => {
    insertReturning.mockResolvedValue([{ id: 'sess-1', expiresAt: new Date(Date.now() + SESSION_TTL_MS) }]);
    const out = await createSession('partner-1');
    expect(out.id).toBe('sess-1');
    const ms = out.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(SESSION_TTL_MS - 1000);
    expect(ms).toBeLessThanOrEqual(SESSION_TTL_MS + 1000);
  });

  it('lookupSession returns null on expired sessions', async () => {
    selectLimit.mockResolvedValue([{ id: 'sess-1', partnerId: 'p', expiresAt: new Date(Date.now() - 1000) }]);
    const out = await lookupSession('sess-1');
    expect(out).toBeNull();
  });

  it('lookupSession returns the row when not expired', async () => {
    const row = { id: 'sess-1', partnerId: 'p', expiresAt: new Date(Date.now() + 60_000) };
    selectLimit.mockResolvedValue([row]);
    const out = await lookupSession('sess-1');
    expect(out).toEqual(row);
  });

  it('revokeSession deletes by id', async () => {
    await revokeSession('sess-1');
    expect(deleteWhere).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/partners/sessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sessions**

Create `lib/partners/sessions.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSessions } from '@/lib/db/schema';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'gc_partner_sess';

export async function createSession(partnerId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db.insert(partnerSessions).values({ partnerId, expiresAt }).returning();
  return { id: row.id, expiresAt };
}

export async function lookupSession(id: string) {
  const rows = await db.select().from(partnerSessions).where(eq(partnerSessions.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function revokeSession(id: string) {
  await db.delete(partnerSessions).where(eq(partnerSessions.id, id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/partners/sessions.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Write the failing test for auth resolver**

Create `tests/partners/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findPartnerByToken = vi.fn();
const findPartnerById = vi.fn();
const lookupSession = vi.fn();

vi.mock('@/lib/partners/queries', () => ({ findPartnerByToken, findPartnerById }));
vi.mock('@/lib/partners/sessions', () => ({
  lookupSession, SESSION_COOKIE: 'gc_partner_sess',
}));

import { resolvePartner } from '@/lib/partners/auth';

beforeEach(() => {
  findPartnerByToken.mockReset();
  findPartnerById.mockReset();
  lookupSession.mockReset();
});

function req(headers: Record<string, string> = {}) {
  return new Request('http://test/whatever', { headers });
}

describe('resolvePartner', () => {
  it('returns null when neither token nor cookie present', async () => {
    expect(await resolvePartner(req(), null)).toBeNull();
  });

  it('resolves via token (URL param) when valid + active', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p1', active: true });
    const out = await resolvePartner(req(), 'TOKEN');
    expect(out).toMatchObject({ id: 'p1' });
  });

  it('returns null when token matches but partner is inactive', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p1', active: false });
    expect(await resolvePartner(req(), 'TOKEN')).toBeNull();
  });

  it('resolves via session cookie', async () => {
    lookupSession.mockResolvedValue({ id: 'sess', partnerId: 'p1' });
    findPartnerById.mockResolvedValue({ id: 'p1', active: true });
    const out = await resolvePartner(req({ cookie: 'gc_partner_sess=sess' }), null);
    expect(out).toMatchObject({ id: 'p1' });
  });

  it('prefers token if both present', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p-from-token', active: true });
    lookupSession.mockResolvedValue({ id: 'sess', partnerId: 'p-from-cookie' });
    findPartnerById.mockResolvedValue({ id: 'p-from-cookie', active: true });
    const out = await resolvePartner(req({ cookie: 'gc_partner_sess=sess' }), 'TOKEN');
    expect(out!.id).toBe('p-from-token');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/partners/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the auth resolver**

Create `lib/partners/auth.ts`:

```typescript
import { findPartnerByToken, findPartnerById } from './queries';
import { lookupSession, SESSION_COOKIE } from './sessions';

export interface ResolvedPartner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  active: boolean;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const piece of raw.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * Resolves the partner for an API request.
 *
 * Order of precedence: URL token first (the link is the source of truth),
 * then session cookie (bookmark / SPA navigation). Inactive partners always
 * resolve to null regardless of credential.
 */
export async function resolvePartner(req: Request, urlToken: string | null): Promise<ResolvedPartner | null> {
  if (urlToken) {
    const p = await findPartnerByToken(urlToken);
    if (!p || !p.active) return null;
    return p as ResolvedPartner;
  }
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const session = await lookupSession(sessionId);
  if (!session) return null;
  const p = await findPartnerById(session.partnerId);
  if (!p || !p.active) return null;
  return p as ResolvedPartner;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test tests/partners/auth.test.ts`
Expected: 5 passing tests.

- [ ] **Step 9: Commit**

```bash
git add lib/partners/sessions.ts lib/partners/auth.ts tests/partners/sessions.test.ts tests/partners/auth.test.ts
git commit -m "feat(partners): session helpers + token-or-cookie auth resolver"
```

---

### Task 9: Bump `lastActiveAt` + first-open helper

**Files:**
- Modify: `lib/partners/queries.ts`
- Test: extend tests later via integration (no unit test for this trivial one)

- [ ] **Step 1: Add helpers to queries module**

Open `lib/partners/queries.ts` and append:

```typescript
export async function markFirstOpenedIfNull(partnerId: string) {
  // Conditional update — only sets firstOpenedAt if it's still NULL.
  await db.update(partners)
    .set({ firstOpenedAt: sql`now()`, lastActiveAt: sql`now()` })
    .where(sql`${partners.id} = ${partnerId} AND ${partners.firstOpenedAt} IS NULL`);
}

export async function bumpLastActive(partnerId: string) {
  await db.update(partners).set({ lastActiveAt: sql`now()` }).where(eq(partners.id, partnerId));
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/partners/queries.ts
git commit -m "feat(partners): markFirstOpenedIfNull + bumpLastActive helpers"
```

---

### Task 10: `GET /api/partners/me` endpoint

**Files:**
- Create: `app/api/partners/me/route.ts`
- Test: `tests/api/partners-me.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/partners-me.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolvePartner = vi.fn();
vi.mock('@/lib/partners/auth', () => ({ resolvePartner }));

vi.mock('@/lib/partners/queries', () => ({
  bumpLastActive: vi.fn().mockResolvedValue(undefined),
}));

const submissionsCount = vi.fn();
vi.mock('@/lib/partners/stats', () => ({ getPartnerStats: submissionsCount }));

import { GET } from '@/app/api/partners/me/route';

beforeEach(() => {
  resolvePartner.mockReset();
  submissionsCount.mockReset();
});

function req(token: string | null) {
  const url = token
    ? `http://test/api/partners/me?token=${token}`
    : 'http://test/api/partners/me';
  return new Request(url);
}

describe('GET /api/partners/me', () => {
  it('401s with no auth', async () => {
    resolvePartner.mockResolvedValue(null);
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it('returns partner profile + stats', async () => {
    resolvePartner.mockResolvedValue({
      id: 'p1', email: 'a@acme.test', firstName: 'A', lastName: 'One', company: 'Acme', active: true,
    });
    submissionsCount.mockResolvedValue({ drafts: 1, submitted: 2, ratingsCount: 0 });
    const res = await GET(req('TOK'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.partner).toMatchObject({ firstName: 'A', company: 'Acme' });
    expect(json.stats).toEqual({ drafts: 1, submitted: 2, ratingsCount: 0 });
  });
});
```

- [ ] **Step 2: Create stats module (stub returns zeros)**

Create `lib/partners/stats.ts`:

```typescript
export interface PartnerStats {
  drafts: number;
  submitted: number;
  ratingsCount: number;
}

/**
 * Returns the partner's activity counts. Stubbed to zeros in this task so the
 * dashboard contract is stable; Task 14 upgrades the implementation to query
 * partner_submissions once the table exists.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getPartnerStats(_partnerId: string): Promise<PartnerStats> {
  return { drafts: 0, submitted: 0, ratingsCount: 0 };
}
```

- [ ] **Step 3: Implement the endpoint**

Create `app/api/partners/me/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { bumpLastActive } from '@/lib/partners/queries';
import { getPartnerStats } from '@/lib/partners/stats';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await bumpLastActive(partner.id);
  const stats = await getPartnerStats(partner.id);

  return NextResponse.json({
    partner: {
      id: partner.id,
      firstName: partner.firstName,
      lastName: partner.lastName,
      company: partner.company,
      email: partner.email,
    },
    stats,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/api/partners-me.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/partners/stats.ts app/api/partners/me tests/api/partners-me.test.ts
git commit -m "feat(api): GET /api/partners/me with profile + stats"
```

---

### Task 11: Partner shell layout + token-cookie handoff

**Files:**
- Create: `app/partners/[token]/layout.tsx`
- Create: `app/partners/[token]/page.tsx` (initial: stub that issues the cookie + branches)

- [ ] **Step 1: Create the partner layout**

Create `app/partners/[token]/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import './partner-shell.css';

interface Props {
  children: ReactNode;
}

export default function PartnerLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Clemson Graphic Communications</div>
            <div className="text-sm font-medium">Industry Partner Survey</div>
          </div>
          <div className="text-xs text-slate-500">Thanks for your time.</div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-6 py-12 text-xs text-slate-500">
        Your responses go directly to the GC faculty curriculum committee.
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Create a trivial partner-shell stylesheet (empty placeholder)**

Create `app/partners/[token]/partner-shell.css`:

```css
/* Partner shell scoped overrides land here once design polish begins. */
```

- [ ] **Step 3: Create the landing route (stub for now)**

Create `app/partners/[token]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { findPartnerByToken } from '@/lib/partners/queries';
import { markFirstOpenedIfNull, bumpLastActive, logPartnerEvent } from '@/lib/partners/queries';
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/partners/sessions';
import { getPartnerStats } from '@/lib/partners/stats';
import { WelcomeScreen } from './WelcomeScreen';
import { PartnerDashboard } from './PartnerDashboard';

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export default async function PartnerLandingPage({ params }: Props) {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return notFound();

  // Issue / refresh the session cookie. The token in the URL is authoritative;
  // the cookie is a convenience so /api calls don't need to re-include the token.
  const session = await createSession(partner.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  });

  // First-time arrival side effects.
  if (!partner.firstOpenedAt) {
    await markFirstOpenedIfNull(partner.id);
    await logPartnerEvent(partner.id, 'opened', { token });
  } else {
    await bumpLastActive(partner.id);
  }

  const stats = await getPartnerStats(partner.id);
  const hasActivity = stats.drafts + stats.submitted + stats.ratingsCount > 0;

  if (!hasActivity) {
    return <WelcomeScreen partner={partner} />;
  }
  return <PartnerDashboard partner={partner} stats={stats} />;
}
```

- [ ] **Step 4: Commit (UI components in next task)**

The page won't compile yet — WelcomeScreen and PartnerDashboard come in Task 12. We commit the layout + stylesheet together with those.

(No commit yet; rolls into Task 12 commit.)

---

### Task 12: Welcome screen + partner dashboard components

**Files:**
- Create: `app/partners/[token]/WelcomeScreen.tsx`
- Create: `app/partners/[token]/PartnerDashboard.tsx`

- [ ] **Step 1: Create WelcomeScreen**

Create `app/partners/[token]/WelcomeScreen.tsx`:

```tsx
import Link from 'next/link';

interface Props {
  partner: { firstName: string; company: string };
}

export function WelcomeScreen({ partner }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Hi {partner.firstName} — thanks for being here.</p>
        <h1 className="mt-1 text-3xl font-semibold">Help us shape what GC graduates can do.</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          We're updating the career targets the Clemson Graphic Communications curriculum builds toward.
          Your input shapes what we teach. About 10 minutes per position you describe, plus an optional 5 minutes
          rating the kinds of projects you'd want grads to have done. You can come back anytime through the same link.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="./submit"
          className="block rounded-lg border border-slate-200 bg-white p-6 hover:border-slate-400"
        >
          <div className="text-lg font-medium">Describe a position you hire for</div>
          <p className="mt-2 text-sm text-slate-600">
            Pick the closest match from our career targets, then tell us about the actual role.
          </p>
        </Link>

        <div className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
          <div className="text-lg font-medium">Rate student projects</div>
          <p className="mt-2 text-sm">Coming soon — second part of the survey.</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create PartnerDashboard**

Create `app/partners/[token]/PartnerDashboard.tsx`:

```tsx
import Link from 'next/link';
import { SubmissionsList } from './submit/SubmissionsList';

interface Props {
  partner: { firstName: string; company: string };
  stats: { drafts: number; submitted: number; ratingsCount: number };
}

export function PartnerDashboard({ partner, stats }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Welcome back, {partner.firstName} ({partner.company}).</p>
        <h1 className="mt-1 text-2xl font-semibold">Your survey</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title="Positions"
          metric={`${stats.submitted} submitted${stats.drafts ? ` · ${stats.drafts} draft` : ''}`}
          cta="Add another position"
          href="./submit"
        />
        <Card
          title="Project ratings"
          metric={`${stats.ratingsCount} rated`}
          cta="Rate more projects"
          href="#"
          disabled
        />
        <Card title="" metric="" cta="I'm done for now" href="./done" subtle />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Your submissions</h2>
        <SubmissionsList />
      </section>
    </div>
  );
}

function Card({ title, metric, cta, href, disabled, subtle }: {
  title: string; metric: string; cta: string; href: string; disabled?: boolean; subtle?: boolean;
}) {
  const base = 'block rounded-lg border p-5';
  const tone = subtle
    ? 'border-dashed border-slate-300 bg-slate-50 text-slate-600'
    : 'border-slate-200 bg-white hover:border-slate-400';
  const inner = (
    <>
      {title && <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>}
      {metric && <div className="mt-1 text-lg font-medium">{metric}</div>}
      <div className={`mt-3 text-sm ${subtle ? '' : 'text-blue-700'}`}>{cta} →</div>
    </>
  );
  if (disabled) return <div className={`${base} ${tone} opacity-60`}>{inner}</div>;
  return <Link href={href} className={`${base} ${tone}`}>{inner}</Link>;
}
```

> Note: `SubmissionsList` is a client component created in Task 17. The page renders fine; the section just shows nothing until Task 17 lands.

- [ ] **Step 3: Stub SubmissionsList so the build compiles now**

Create `app/partners/[token]/submit/SubmissionsList.tsx` (will be expanded in Task 17):

```tsx
'use client';

export function SubmissionsList() {
  return <p className="text-sm text-slate-500">Your submissions will appear here.</p>;
}
```

- [ ] **Step 4: Stub the /done route**

Create `app/partners/[token]/done/page.tsx`:

```tsx
export default function DonePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Thank you.</h1>
      <p className="text-slate-700">Your input will help shape what we teach. You can return any time through the same link if you want to add more.</p>
    </div>
  );
}
```

- [ ] **Step 5: Manual smoke test the landing flow**

Run: `pnpm dev`

1. Use the admin UI from Task 6 to import a single partner with your own email.
2. Open the magic-link URL emailed to you (or pull it from the DB if Resend isn't configured locally).
3. First load: should see WelcomeScreen.
4. Reload: still WelcomeScreen (no activity yet).
5. Check the DB: `partners.firstOpenedAt` set; one `partner_events` row with `opened`; one `partner_sessions` row.

- [ ] **Step 6: Commit**

```bash
git add app/partners/[token]
git commit -m "feat(partners): magic-link landing, welcome screen, dashboard shell"
```

---

# Phase 3 — Submission flow A (draft + submit)

### Task 13: `partner_submissions` table

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0006_<auto>.sql`
- Test: `lib/db/__tests__/partner-submissions-schema.test.ts` (create)

- [ ] **Step 1: Append the table definition**

Add to `lib/db/schema.ts` (after `partnerEvents`):

```typescript
export const partnerSubmissions = pgTable('partner_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').references(() => careerTargets.id),
  unmappedTargetLabel: text('unmapped_target_label'),
  positionTitle: text('position_title').notNull(),
  responsibilities: text('responsibilities').notNull().default(''),
  salaryRangeLow: integer('salary_range_low'),
  salaryRangeHigh: integer('salary_range_high'),
  salaryCurrency: text('salary_currency').notNull().default('USD'),
  interviewQuestions: jsonb('interview_questions').$type<string[]>().notNull().default([]),
  requiredSkills: jsonb('required_skills').$type<string[]>().notNull().default([]),
  niceToHaveSkills: jsonb('nice_to_have_skills').$type<string[]>().notNull().default([]),
  additionalNotes: text('additional_notes').notNull().default(''),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});
```

- [ ] **Step 2: Generate + apply migration**

Run: `pnpm db:generate && pnpm db:migrate`
Expected: `drizzle/0006_*.sql` created and applied.

- [ ] **Step 3: Write schema smoke test**

Create `lib/db/__tests__/partner-submissions-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { partnerSubmissions } from '@/lib/db/schema';

describe('partner_submissions schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(partnerSubmissions);
    for (const c of ['id', 'partnerId', 'careerTargetId', 'unmappedTargetLabel',
                     'positionTitle', 'responsibilities', 'salaryRangeLow', 'salaryRangeHigh',
                     'salaryCurrency', 'interviewQuestions', 'requiredSkills',
                     'niceToHaveSkills', 'additionalNotes', 'status', 'createdAt',
                     'updatedAt', 'submittedAt']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm test lib/db/__tests__/partner-submissions-schema.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/0006_*.sql lib/db/__tests__/partner-submissions-schema.test.ts
git commit -m "feat(db): partner_submissions table"
```

---

### Task 14: Submission queries module

**Files:**
- Create: `lib/partners/submission-queries.ts`
- Test: covered via the API tests in T16 (no separate unit test for thin DB helpers)

- [ ] **Step 1: Create the module**

Create `lib/partners/submission-queries.ts`:

```typescript
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSubmissions } from '@/lib/db/schema';

export type SubmissionRow = typeof partnerSubmissions.$inferSelect;

export interface DraftPatch {
  careerTargetId?: string | null;
  unmappedTargetLabel?: string | null;
  positionTitle?: string;
  responsibilities?: string;
  salaryRangeLow?: number | null;
  salaryRangeHigh?: number | null;
  salaryCurrency?: string;
  interviewQuestions?: string[];
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  additionalNotes?: string;
}

export async function listSubmissions(partnerId: string) {
  return db.select().from(partnerSubmissions)
    .where(eq(partnerSubmissions.partnerId, partnerId))
    .orderBy(desc(partnerSubmissions.updatedAt));
}

export async function findSubmission(partnerId: string, id: string) {
  const rows = await db.select().from(partnerSubmissions)
    .where(and(eq(partnerSubmissions.partnerId, partnerId), eq(partnerSubmissions.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createDraft(partnerId: string, patch: DraftPatch) {
  if (!patch.positionTitle) throw new Error('positionTitle required to create');
  const [row] = await db.insert(partnerSubmissions).values({
    partnerId,
    careerTargetId: patch.careerTargetId ?? null,
    unmappedTargetLabel: patch.unmappedTargetLabel ?? null,
    positionTitle: patch.positionTitle,
    responsibilities: patch.responsibilities ?? '',
    salaryRangeLow: patch.salaryRangeLow ?? null,
    salaryRangeHigh: patch.salaryRangeHigh ?? null,
    salaryCurrency: patch.salaryCurrency ?? 'USD',
    interviewQuestions: patch.interviewQuestions ?? [],
    requiredSkills: patch.requiredSkills ?? [],
    niceToHaveSkills: patch.niceToHaveSkills ?? [],
    additionalNotes: patch.additionalNotes ?? '',
    status: 'draft',
  }).returning();
  return row;
}

export async function updateDraft(partnerId: string, id: string, patch: DraftPatch) {
  const [row] = await db.update(partnerSubmissions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(
      eq(partnerSubmissions.partnerId, partnerId),
      eq(partnerSubmissions.id, id),
      eq(partnerSubmissions.status, 'draft'),
    ))
    .returning();
  return row ?? null;
}

export async function submitDraft(partnerId: string, id: string) {
  const [row] = await db.update(partnerSubmissions)
    .set({ status: 'submitted', submittedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(partnerSubmissions.partnerId, partnerId),
      eq(partnerSubmissions.id, id),
      eq(partnerSubmissions.status, 'draft'),
    ))
    .returning();
  return row ?? null;
}

export async function deleteSubmission(partnerId: string, id: string) {
  const rows = await db.delete(partnerSubmissions)
    .where(and(eq(partnerSubmissions.partnerId, partnerId), eq(partnerSubmissions.id, id)))
    .returning({ id: partnerSubmissions.id });
  return rows.length > 0;
}
```

- [ ] **Step 2: Upgrade `getPartnerStats` to query the real table**

Now that `partner_submissions` exists, replace `lib/partners/stats.ts` with the real implementation:

```typescript
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSubmissions } from '@/lib/db/schema';

export interface PartnerStats {
  drafts: number;
  submitted: number;
  ratingsCount: number;
}

/**
 * Counts the partner's submissions by status. `ratingsCount` stays 0 until
 * the project-rating tables land in Plan 2; the field is here so the
 * dashboard contract doesn't change when ratings ship.
 */
export async function getPartnerStats(partnerId: string): Promise<PartnerStats> {
  const rows = await db.select({
    status: partnerSubmissions.status,
    n: sql<number>`count(*)::int`,
  })
    .from(partnerSubmissions)
    .where(eq(partnerSubmissions.partnerId, partnerId))
    .groupBy(partnerSubmissions.status);

  let drafts = 0, submitted = 0;
  for (const r of rows) {
    if (r.status === 'draft') drafts = r.n;
    else if (r.status === 'submitted') submitted = r.n;
  }
  return { drafts, submitted, ratingsCount: 0 };
}
```

- [ ] **Step 3: Re-run the /me endpoint test to confirm nothing broke**

Run: `pnpm test tests/api/partners-me.test.ts`
Expected: still 2 passing (test mocks `getPartnerStats`, so the real change is independent of unit tests).

- [ ] **Step 4: Commit**

```bash
git add lib/partners/submission-queries.ts lib/partners/stats.ts
git commit -m "feat(partners): submission CRUD queries + real stats counts"
```

---

### Task 15: Submission CRUD API endpoints

**Files:**
- Create: `app/api/partners/submissions/route.ts`
- Create: `app/api/partners/submissions/[submissionId]/route.ts`
- Create: `app/api/partners/submissions/[submissionId]/submit/route.ts`
- Create: `app/api/partners/target-options/route.ts`
- Test: `tests/api/partners-submissions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/partners-submissions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolvePartner = vi.fn();
vi.mock('@/lib/partners/auth', () => ({ resolvePartner }));

const listSubmissions = vi.fn();
const findSubmission = vi.fn();
const createDraft = vi.fn();
const updateDraft = vi.fn();
const submitDraft = vi.fn();
const deleteSubmission = vi.fn();
const logPartnerEvent = vi.fn();
const bumpLastActive = vi.fn();

vi.mock('@/lib/partners/submission-queries', () => ({
  listSubmissions, findSubmission, createDraft, updateDraft, submitDraft, deleteSubmission,
}));
vi.mock('@/lib/partners/queries', () => ({ logPartnerEvent, bumpLastActive }));

import { GET as listRoute, POST as createRoute } from '@/app/api/partners/submissions/route';
import { GET as getOne, PATCH as patchOne, DELETE as delOne }
  from '@/app/api/partners/submissions/[submissionId]/route';
import { POST as submitRoute } from '@/app/api/partners/submissions/[submissionId]/submit/route';

beforeEach(() => {
  for (const m of [resolvePartner, listSubmissions, findSubmission, createDraft, updateDraft,
                   submitDraft, deleteSubmission, logPartnerEvent, bumpLastActive]) m.mockReset();
  resolvePartner.mockResolvedValue({ id: 'p1', firstName: 'A', lastName: 'X', email: 'a@x', company: 'X', active: true });
  bumpLastActive.mockResolvedValue(undefined);
  logPartnerEvent.mockResolvedValue(undefined);
});

function jsonReq(method: string, body?: unknown) {
  return new Request('http://test/api/partners/submissions', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/partners/submissions', () => {
  it('returns the partner\'s submissions', async () => {
    listSubmissions.mockResolvedValue([{ id: 's1', positionTitle: 'Press Op', status: 'submitted' }]);
    const res = await listRoute(new Request('http://test/api/partners/submissions'));
    const json = await res.json();
    expect(json.submissions).toHaveLength(1);
  });

  it('401s when unauth', async () => {
    resolvePartner.mockResolvedValue(null);
    const res = await listRoute(new Request('http://test/api/partners/submissions'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/partners/submissions', () => {
  it('creates a draft with at minimum positionTitle', async () => {
    createDraft.mockResolvedValue({ id: 's-new', positionTitle: 'Press Op', status: 'draft' });
    const res = await createRoute(jsonReq('POST', { positionTitle: 'Press Op' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.submission.id).toBe('s-new');
    expect(createDraft).toHaveBeenCalledWith('p1', expect.objectContaining({ positionTitle: 'Press Op' }));
  });

  it('400s when positionTitle missing', async () => {
    const res = await createRoute(jsonReq('POST', { responsibilities: 'no title' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH submission', () => {
  it('updates a draft', async () => {
    updateDraft.mockResolvedValue({ id: 's1', positionTitle: 'Updated', status: 'draft' });
    const res = await patchOne(jsonReq('PATCH', { positionTitle: 'Updated' }), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
  });

  it('404s when draft not found / already submitted', async () => {
    updateDraft.mockResolvedValue(null);
    const res = await patchOne(jsonReq('PATCH', { positionTitle: 'x' }), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST :submit', () => {
  it('flips status to submitted + logs event', async () => {
    submitDraft.mockResolvedValue({ id: 's1', positionTitle: 'X', status: 'submitted', careerTargetId: 't1' });
    const res = await submitRoute(jsonReq('POST'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
    expect(logPartnerEvent).toHaveBeenCalledWith('p1', 'submitted_position',
      expect.objectContaining({ submissionId: 's1', careerTargetId: 't1' }));
  });

  it('409 if already submitted (submitDraft returns null)', async () => {
    submitDraft.mockResolvedValue(null);
    const res = await submitRoute(jsonReq('POST'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(409);
  });
});

describe('DELETE submission', () => {
  it('204 when deleted', async () => {
    deleteSubmission.mockResolvedValue(true);
    const res = await delOne(jsonReq('DELETE'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(204);
  });

  it('404 when not found', async () => {
    deleteSubmission.mockResolvedValue(false);
    const res = await delOne(jsonReq('DELETE'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(404);
  });
});

describe('GET one submission', () => {
  it('returns the row', async () => {
    findSubmission.mockResolvedValue({ id: 's1', positionTitle: 'X', status: 'draft' });
    const res = await getOne(jsonReq('GET'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.submission.id).toBe('s1');
  });
  it('404 when not owned', async () => {
    findSubmission.mockResolvedValue(null);
    const res = await getOne(jsonReq('GET'), { params: Promise.resolve({ submissionId: 'x' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/partners-submissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the list + create endpoint**

Create `app/api/partners/submissions/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { listSubmissions, createDraft } from '@/lib/partners/submission-queries';
import { bumpLastActive, logPartnerEvent } from '@/lib/partners/queries';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const submissions = await listSubmissions(partner.id);
  return NextResponse.json({ submissions });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.positionTitle || typeof body.positionTitle !== 'string') {
    return NextResponse.json({ error: 'positionTitle is required' }, { status: 400 });
  }

  const submission = await createDraft(partner.id, body);
  await bumpLastActive(partner.id);
  await logPartnerEvent(partner.id, 'started_submission', { submissionId: submission.id });
  return NextResponse.json({ submission }, { status: 201 });
}
```

- [ ] **Step 4: Implement the [submissionId] endpoint**

Create `app/api/partners/submissions/[submissionId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { findSubmission, updateDraft, deleteSubmission } from '@/lib/partners/submission-queries';
import { bumpLastActive } from '@/lib/partners/queries';

interface Ctx { params: Promise<{ submissionId: string }>; }

async function authed(req: Request) {
  const url = new URL(req.url);
  return resolvePartner(req, url.searchParams.get('token'));
}

export async function GET(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const submission = await findSubmission(partner.id, submissionId);
  if (!submission) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ submission });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = await updateDraft(partner.id, submissionId, body);
  if (!updated) return NextResponse.json({ error: 'draft not found or already submitted' }, { status: 404 });
  await bumpLastActive(partner.id);
  return NextResponse.json({ submission: updated });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const ok = await deleteSubmission(partner.id, submissionId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await bumpLastActive(partner.id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: Implement the submit endpoint**

Create `app/api/partners/submissions/[submissionId]/submit/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { submitDraft } from '@/lib/partners/submission-queries';
import { bumpLastActive, logPartnerEvent } from '@/lib/partners/queries';

interface Ctx { params: Promise<{ submissionId: string }>; }

export async function POST(req: Request, { params }: Ctx) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const row = await submitDraft(partner.id, submissionId);
  if (!row) return NextResponse.json({ error: 'draft not found or already submitted' }, { status: 409 });
  await bumpLastActive(partner.id);
  await logPartnerEvent(partner.id, 'submitted_position', {
    submissionId: row.id,
    careerTargetId: row.careerTargetId,
    unmappedTargetLabel: row.unmappedTargetLabel,
  });
  return NextResponse.json({ submission: row });
}
```

- [ ] **Step 6: Implement target-options endpoint**

Create `app/api/partners/target-options/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { resolvePartner } from '@/lib/partners/auth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const targets = await db.select({
    id: careerTargets.id,
    name: careerTargets.name,
    shortDefinition: careerTargets.shortDefinition,
    industryContexts: careerTargets.industryContexts,
  }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  return NextResponse.json({ targets });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test tests/api/partners-submissions.test.ts`
Expected: all tests passing (12 total).

- [ ] **Step 8: Commit**

```bash
git add app/api/partners tests/api/partners-submissions.test.ts
git commit -m "feat(api): partner submission CRUD endpoints + target-options"
```

---

### Task 16: Submission wizard shell route

**Files:**
- Create: `app/partners/[token]/submit/page.tsx`
- Create: `app/partners/[token]/submit/SubmissionWizard.tsx`

- [ ] **Step 1: Create the route**

Create `app/partners/[token]/submit/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { SubmissionWizard } from './SubmissionWizard';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ draft?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function SubmitPage({ params, searchParams }: Props) {
  const [{ token }, { draft }] = await Promise.all([params, searchParams]);
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return notFound();

  const targets = await db.select({
    id: careerTargets.id,
    name: careerTargets.name,
    shortDefinition: careerTargets.shortDefinition,
    industryContexts: careerTargets.industryContexts,
  }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  return <SubmissionWizard token={token} targets={targets} draftId={draft ?? null} />;
}
```

- [ ] **Step 2: Create the wizard client component**

Create `app/partners/[token]/submit/SubmissionWizard.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { CareerTargetPicker, type TargetOption } from './CareerTargetPicker';
import { PositionForm, type PositionFormValues } from './PositionForm';
import { SubmissionConfirmation } from './SubmissionConfirmation';

interface Props {
  token: string;
  targets: TargetOption[];
  draftId: string | null;
}

type Step = 1 | 2 | 3;

const EMPTY: PositionFormValues = {
  positionTitle: '', responsibilities: '',
  salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD',
  interviewQuestions: [], requiredSkills: [], niceToHaveSkills: [],
  additionalNotes: '',
};

export function SubmissionWizard({ token, targets, draftId }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<string | null>(null);
  const [values, setValues] = useState<PositionFormValues>(EMPTY);
  const [submissionId, setSubmissionId] = useState<string | null>(draftId);
  const [saving, setSaving] = useState(false);
  const [submittedTitle, setSubmittedTitle] = useState('');

  // Hydrate draft if draftId passed in URL.
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const res = await fetch(`/api/partners/submissions/${draftId}`);
      if (!res.ok) return;
      const { submission } = await res.json();
      setTargetId(submission.careerTargetId);
      setUnmapped(submission.unmappedTargetLabel);
      setValues({
        positionTitle: submission.positionTitle,
        responsibilities: submission.responsibilities,
        salaryRangeLow: submission.salaryRangeLow,
        salaryRangeHigh: submission.salaryRangeHigh,
        salaryCurrency: submission.salaryCurrency,
        interviewQuestions: submission.interviewQuestions ?? [],
        requiredSkills: submission.requiredSkills ?? [],
        niceToHaveSkills: submission.niceToHaveSkills ?? [],
        additionalNotes: submission.additionalNotes,
      });
      setStep(2);
    })();
  }, [draftId]);

  async function ensureDraft(): Promise<string> {
    if (submissionId) return submissionId;
    const res = await fetch('/api/partners/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        positionTitle: values.positionTitle || 'Untitled position',
        careerTargetId: targetId,
        unmappedTargetLabel: unmapped,
      }),
    });
    const { submission } = await res.json();
    setSubmissionId(submission.id);
    return submission.id;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const id = await ensureDraft();
      await fetch(`/api/partners/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, careerTargetId: targetId, unmappedTargetLabel: unmapped }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const id = await ensureDraft();
      const patch = await fetch(`/api/partners/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, careerTargetId: targetId, unmappedTargetLabel: unmapped }),
      });
      if (!patch.ok) {
        alert('Save failed. Try again.');
        return;
      }
      const fin = await fetch(`/api/partners/submissions/${id}/submit`, { method: 'POST' });
      if (!fin.ok) {
        alert('Submit failed. Try again.');
        return;
      }
      setSubmittedTitle(values.positionTitle);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ProgressBar step={step} />
      {step === 1 && (
        <CareerTargetPicker
          targets={targets}
          selectedId={targetId}
          unmapped={unmapped}
          onPick={(id) => { setTargetId(id); setUnmapped(null); }}
          onUnmapped={(label) => { setUnmapped(label); setTargetId(null); }}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <PositionForm
          values={values}
          onChange={setValues}
          onSaveDraft={saveDraft}
          onSubmit={submit}
          onBack={() => setStep(1)}
          saving={saving}
        />
      )}
      {step === 3 && (
        <SubmissionConfirmation
          title={submittedTitle}
          token={token}
          onAddAnother={() => {
            setStep(1);
            setTargetId(null);
            setUnmapped(null);
            setValues(EMPTY);
            setSubmissionId(null);
            setSubmittedTitle('');
          }}
        />
      )}
    </div>
  );
}

function ProgressBar({ step }: { step: Step }) {
  const labels = ['Choose closest match', 'Describe the position', 'Done'];
  return (
    <ol className="flex gap-2 text-xs">
      {labels.map((l, i) => {
        const idx = (i + 1) as Step;
        const done = step > idx, active = step === idx;
        return (
          <li key={l} className={`flex-1 rounded px-3 py-2 text-center ${
            active ? 'bg-slate-800 text-white' : done ? 'bg-slate-200' : 'bg-slate-50 text-slate-500'
          }`}>
            {idx}. {l}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 3: Commit (component files follow in Tasks 17–19)**

Don't run the dev server yet — the imports below don't exist. Commit happens after Task 19.

---

### Task 17: CareerTargetPicker component (Step 1)

**Files:**
- Create: `app/partners/[token]/submit/CareerTargetPicker.tsx`
- Replace: stub `app/partners/[token]/submit/SubmissionsList.tsx` from Task 12 with the real one

- [ ] **Step 1: Create CareerTargetPicker**

Create `app/partners/[token]/submit/CareerTargetPicker.tsx`:

```tsx
'use client';

import { useState } from 'react';

export interface TargetOption {
  id: string;
  name: string;
  shortDefinition: string;
  industryContexts: string[];
}

interface Props {
  targets: TargetOption[];
  selectedId: string | null;
  unmapped: string | null;
  onPick: (id: string) => void;
  onUnmapped: (label: string) => void;
  onContinue: () => void;
}

export function CareerTargetPicker({ targets, selectedId, unmapped, onPick, onUnmapped, onContinue }: Props) {
  const [unmappedDraft, setUnmappedDraft] = useState(unmapped ?? '');
  const [openUnmapped, setOpenUnmapped] = useState(Boolean(unmapped));

  const canContinue = Boolean(selectedId) || Boolean(unmapped && unmapped.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pick the closest match</h1>
        <p className="mt-1 text-slate-600">Which of these is closest to a role you hire GC graduates into?</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {targets.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className={`block rounded-lg border p-4 text-left transition ${
              selectedId === t.id ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
          >
            <div className="font-medium">{t.name}</div>
            <p className="mt-1 text-sm text-slate-600">{t.shortDefinition}</p>
            {t.industryContexts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.industryContexts.map(c => (
                  <span key={c} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c}</span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="border-t border-dashed border-slate-300 pt-4">
        {!openUnmapped ? (
          <button type="button" onClick={() => setOpenUnmapped(true)} className="text-sm text-blue-700 hover:underline">
            None of these quite fit — let me describe it
          </button>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Tell us what to call this role</label>
            <input
              type="text"
              value={unmappedDraft}
              onChange={e => { setUnmappedDraft(e.target.value); onUnmapped(e.target.value); }}
              placeholder="e.g., Packaging design lead"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="rounded bg-slate-800 px-5 py-2 text-sm text-white disabled:opacity-50"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace SubmissionsList with real one**

Overwrite `app/partners/[token]/submit/SubmissionsList.tsx`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';

interface Submission {
  id: string;
  positionTitle: string;
  status: 'draft' | 'submitted';
  updatedAt: string;
  careerTargetId: string | null;
  unmappedTargetLabel: string | null;
}

export function SubmissionsList() {
  const [list, setList] = useState<Submission[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch('/api/partners/submissions')
      .then(r => r.ok ? r.json() : { submissions: [] })
      .then(j => setList(j.submissions));
  }, []);

  function remove(id: string) {
    if (!confirm('Delete this submission? You can re-create it later.')) return;
    start(async () => {
      const res = await fetch(`/api/partners/submissions/${id}`, { method: 'DELETE' });
      if (res.ok) setList(prev => prev?.filter(s => s.id !== id) ?? null);
    });
  }

  if (list === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (list.length === 0) return <p className="text-sm text-slate-500">Nothing yet.</p>;

  return (
    <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
      {list.map(s => (
        <li key={s.id} className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="font-medium">{s.positionTitle}</div>
            <div className="text-xs text-slate-500">
              {s.status === 'draft' ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Draft</span>
                                    : <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">Submitted</span>}
              {' · '}updated {new Date(s.updatedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="flex gap-3 text-sm">
            {s.status === 'draft' && (
              <Link href={`./submit?draft=${s.id}`} className="text-blue-700 hover:underline">Resume</Link>
            )}
            <button onClick={() => remove(s.id)} disabled={pending} className="text-red-700 hover:underline disabled:opacity-50">
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Commit (wizard glue still pending)**

No commit yet — Tasks 18 and 19 add the remaining components and one combined commit lands at Task 19.

---

### Task 18: PositionForm component (Step 2)

**Files:**
- Create: `app/partners/[token]/submit/PositionForm.tsx`

- [ ] **Step 1: Create PositionForm**

Create `app/partners/[token]/submit/PositionForm.tsx`:

```tsx
'use client';

import { useState } from 'react';

export interface PositionFormValues {
  positionTitle: string;
  responsibilities: string;
  salaryRangeLow: number | null;
  salaryRangeHigh: number | null;
  salaryCurrency: string;
  interviewQuestions: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  additionalNotes: string;
}

interface Props {
  values: PositionFormValues;
  onChange: (v: PositionFormValues) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onBack: () => void;
  saving: boolean;
}

export function PositionForm({ values, onChange, onSaveDraft, onSubmit, onBack, saving }: Props) {
  const set = <K extends keyof PositionFormValues>(k: K, v: PositionFormValues[K]) =>
    onChange({ ...values, [k]: v });

  const canSubmit = values.positionTitle.trim().length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Describe the position</h1>
          <p className="mt-1 text-slate-600">Skip anything you don't want to answer. Only job title is required.</p>
        </div>
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saving}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </div>

      <Section title="Position basics">
        <Field label="Job title *">
          <input type="text" value={values.positionTitle} onChange={e => set('positionTitle', e.target.value)}
                 className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
        <Field label="Responsibilities">
          <textarea value={values.responsibilities} onChange={e => set('responsibilities', e.target.value)} rows={4}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </Section>

      <Section title="Compensation (optional)">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Low">
            <input type="number" value={values.salaryRangeLow ?? ''}
                   onChange={e => set('salaryRangeLow', e.target.value === '' ? null : Number(e.target.value))}
                   className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Field label="High">
            <input type="number" value={values.salaryRangeHigh ?? ''}
                   onChange={e => set('salaryRangeHigh', e.target.value === '' ? null : Number(e.target.value))}
                   className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Field label="Currency">
            <select value={values.salaryCurrency} onChange={e => set('salaryCurrency', e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="What you look for">
        <Field label="Required skills">
          <TagsInput tags={values.requiredSkills} onChange={t => set('requiredSkills', t)}
                     placeholder="press to add — e.g., Color management" />
        </Field>
        <Field label="Nice-to-have skills">
          <TagsInput tags={values.niceToHaveSkills} onChange={t => set('niceToHaveSkills', t)}
                     placeholder="press to add" />
        </Field>
      </Section>

      <Section title="How you screen">
        <Field label="Interview questions you'd actually ask">
          <RepeatableTextRows
            rows={values.interviewQuestions}
            onChange={r => set('interviewQuestions', r)}
            placeholder="What's the question?"
            addLabel="+ add another"
          />
        </Field>
        <Field label="Anything else worth knowing">
          <textarea value={values.additionalNotes} onChange={e => set('additionalNotes', e.target.value)} rows={3}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </Section>

      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-slate-600 hover:underline">← Back</button>
        <div className="flex gap-2">
          <button type="button" onClick={onSaveDraft} disabled={saving}
                  className="rounded border border-slate-300 px-4 py-2 text-sm">Save draft</button>
          <button type="button" onClick={onSubmit} disabled={!canSubmit || saving}
                  className="rounded bg-slate-800 px-5 py-2 text-sm text-white disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function TagsInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  function commit() {
    const t = draft.trim();
    if (!t) return;
    onChange([...tags, t]);
    setDraft('');
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} className="text-slate-500 hover:text-slate-800">×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function RepeatableTextRows({ rows, onChange, placeholder, addLabel }: {
  rows: string[]; onChange: (r: string[]) => void; placeholder?: string; addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={r}
            onChange={e => onChange(rows.map((rr, j) => j === i ? e.target.value : rr))}
            placeholder={placeholder}
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="text-sm text-slate-500 hover:text-slate-800">remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ''])} className="text-sm text-blue-700 hover:underline">
        {addLabel}
      </button>
    </div>
  );
}
```

---

### Task 19: SubmissionConfirmation + final wire-up

**Files:**
- Create: `app/partners/[token]/submit/SubmissionConfirmation.tsx`

- [ ] **Step 1: Create SubmissionConfirmation**

Create `app/partners/[token]/submit/SubmissionConfirmation.tsx`:

```tsx
'use client';

import Link from 'next/link';

interface Props {
  title: string;
  token: string;
  onAddAnother: () => void;
}

export function SubmissionConfirmation({ title, token, onAddAnother }: Props) {
  const base = `/partners/${token}`;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Got it — thank you.</h1>
        <p className="mt-2 text-slate-700">We've recorded <strong>{title}</strong>. You can describe another position, rate student projects, or finish up.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAddAnother}
          className="rounded bg-slate-800 px-5 py-2 text-sm text-white"
        >
          Add another position
        </button>
        <Link href={base} className="rounded border border-slate-300 px-5 py-2 text-sm">
          See my submissions
        </Link>
        <Link href={`${base}/done`} className="rounded border border-slate-300 px-5 py-2 text-sm">
          I'm done
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual end-to-end smoke test**

Run: `pnpm dev`

1. Visit `/admin/partners?slug=<your-slug>` — import a CSV row with your email.
2. Open the magic-link from the invite (or directly from DB).
3. Welcome screen → click "Describe a position you hire for".
4. Pick a career target → Continue.
5. Fill in `positionTitle` (only required field).
6. Click "Save draft" — verify a row appears in `partner_submissions` with status='draft'.
7. Reload the page — confirm draft persists; resume via dashboard "Resume" link.
8. Fill the rest, click Submit — see Step 3 confirmation.
9. Return to dashboard — see one Submitted entry. Try Delete — row disappears.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all tests passing.

- [ ] **Step 4: Run lint + typecheck**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit the wizard end-to-end**

```bash
git add app/partners/[token]/submit
git commit -m "feat(partners): position-submission wizard (target picker → form → confirmation)"
```

---

### Task 20: Documentation pass

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/superpowers/plans/2026-05-19-industry-partner-input-plan-1-foundation.md` (append status footer)
- Modify: `README.md`

- [ ] **Step 1: Update the docs index**

In `docs/superpowers/README.md`, add a row to the Plans table:

```markdown
| 2026-05-19 | [`plans/2026-05-19-industry-partner-input-plan-1-foundation.md`](./plans/2026-05-19-industry-partner-input-plan-1-foundation.md) | ✅ Done. Partners table + CSV import + invite email, magic-link auth, position-submission flow. |
```

(Mark Done only after the entire plan is executed and verified.)

- [ ] **Step 2: Update top-level README**

In `README.md`, under Status, add a line:

```markdown
**Industry Partner Input — Plan 1 shipped.** Magic-link survey is live; admin can invite via CSV; partners can describe positions (draft + submit). Plans 2 and 3 (admin views + project ratings + AI synthesis) still ahead.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/README.md README.md
git commit -m "docs: mark Industry Partner Input Plan 1 complete"
```

---

## Plan Self-Review Checklist

After implementing all 20 tasks, verify:

- [ ] **Spec coverage:** Every Phase 1–3 requirement in the spec has a corresponding task. (Phases 4–7 are Plans 2 and 3, intentionally out of scope.)
- [ ] **No partner request can reach faculty routes.** Inspect: `app/admin/*` always reads `slug` query/body and calls `isValidSlug`; `app/partners/*` never calls admin queries.
- [ ] **Tokens never logged or returned by list endpoints.** Grep for `magicToken` — appears only in: schema, queries module write path, auth resolver, the partner's own dashboard render, the invite email. Never in `JSON.stringify`, list endpoints, or `console.log`.
- [ ] **Rate limits not yet wired in v1 plan 1.** Per spec the limits are 50 submission writes/day and 200 ratings/day. Ratings ship in Plan 2; submission rate-limit is an explicit follow-on in Plan 2 along with the rest of the admin surface. Do not add it here.
- [ ] **Migration ordering.** `0005` ships partners/sessions/events; `0006` ships submissions. Drizzle generates serial filenames; verify the order matches when running `pnpm db:generate`.
- [ ] **Type consistency:** `PositionFormValues` keys match `partner_submissions` columns; `DraftPatch` accepts the same fields; API endpoints accept the same fields. If you renamed any in implementation, update all three.
- [ ] **CSV column names match end-to-end:** `email,firstName,lastName,company,roleTitle,weight,careerTargetHints` in CSV → same casing in `PartnerCsvRow` → same in admin dialog help text.

If any check fails, fix inline before declaring the plan done.

---

## What's NOT in this plan (saved for Plan 2 and Plan 3)

**Plan 2:**
- Admin pages: per-partner edit (name/company/weight/notes), deactivate/reactivate, submissions firehose.
- Project rating flow (`partner_project_ratings` table, /partners/[token]/rate route, rating UI).
- Per-partner rate-limit middleware (50 submissions/day, 200 ratings/day).
- Admin partners table polish (filters, search, CSV export of submissions).

**Plan 3:**
- AI synthesis pipeline (`synthesis_runs` table + `lib/ai/synthesis/`).
- Per-target synthesis dashboard at `/admin/synthesis/targets/[targetId]`.
- Project-ratings heat map.
- `project_comment_summaries` cache + `summarizeProjectComments`.
- Daily-cost integration for synthesis runs.
