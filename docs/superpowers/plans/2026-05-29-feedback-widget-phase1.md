# Feedback Widget — Phase 1 (Intake → GitHub Issue) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a faculty-facing in-app feedback widget today. Floating "💬 Feedback" button on every faculty page → modal with name (encouraged) + freeform feedback → `POST /api/feedback` → creates a GitHub Issue in the repo with auto-captured context. No AI triage in Phase 1 — that's Phase 2.

**Architecture:** A small client component `FeedbackWidget.tsx` mounted once at the root layout. It self-gates on URL `?slug=` presence (the same slug every faculty surface already requires), so it appears only on faculty pages and disappears on `/partners/*` / `/preview/*` / unauthenticated landings. On submit, it POSTs to `/api/feedback` which: validates slug + rate-limits, builds a structured Markdown issue body from the captured fields, calls the GitHub REST API (`POST /repos/{owner}/{repo}/issues` with the `gc-feedback` label), and returns `{ issueUrl }` to the client. Server-side env: `GITHUB_TOKEN` (PAT with `repo` scope) + `GITHUB_FEEDBACK_REPO` (`owner/repo`). When unset, the endpoint returns 503 with a clear "not configured" message so deploys without the token fail loud rather than silently dropping reports. Name is persisted to localStorage on first submission so subsequent reports auto-fill (the gentle UX nudge to identify yourself).

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind, existing `isValidSlug` + `checkIpRateLimit` + `hashIp` patterns, GitHub REST API v3, no new DB tables, no new schema.

---

## File structure

- **Create:** `lib/feedback/github.ts` — pure helper for issue body composition + GitHub API call
- **Create:** `app/api/feedback/route.ts` — POST endpoint
- **Create:** `app/FeedbackWidget.tsx` — client component (floating button + modal)
- **Modify:** `app/layout.tsx` — mount `<FeedbackWidget />`
- **Modify:** `.env.example` — document `GITHUB_TOKEN` + `GITHUB_FEEDBACK_REPO`
- **Modify:** `docs/STATE.md` — note the new route, env vars, and what's live

---

## Task 1: GitHub issue helper + env documentation

**Files:** Create `lib/feedback/github.ts`; modify `.env.example`.

- [ ] **Step 1: Write the helper**

Create `lib/feedback/github.ts`:

```typescript
/**
 * Compose a feedback issue body + call the GitHub REST API.
 *
 * Reads GITHUB_TOKEN (PAT, repo scope) + GITHUB_FEEDBACK_REPO ("owner/repo").
 * Returns either { ok: true, issueUrl, issueNumber } or { ok: false, reason }.
 *
 * `reason: 'not-configured'` is the sentinel the route uses to surface a 503
 * with a useful message when the env vars aren't set — distinct from a
 * GitHub-API transport failure.
 */

export interface FeedbackInput {
  name: string | null;
  feedback: string;
  route: string;       // e.g. '/capture/GC%204800'
  courseCode: string | null;  // best-effort extract from the route
  userAgent: string;
  capturedAt: string;  // ISO timestamp from the server
}

export interface CreateFeedbackIssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  reason?: 'not-configured' | 'github-error' | string;
  errorDetail?: string;
}

function titleFromFeedback(input: FeedbackInput): string {
  const who = input.name ? `${input.name}: ` : '';
  const head = input.feedback.replace(/\s+/g, ' ').trim().slice(0, 70);
  const ellipsis = input.feedback.trim().length > 70 ? '…' : '';
  return `feedback — ${who}${head}${ellipsis}`;
}

function bodyFromFeedback(input: FeedbackInput): string {
  return [
    `**From:** ${input.name ?? '_(anonymous)_'}`,
    `**Route:** \`${input.route}\``,
    input.courseCode ? `**Course:** ${input.courseCode}` : null,
    `**Captured:** ${input.capturedAt}`,
    `**User agent:** \`${input.userAgent}\``,
    '',
    '---',
    '',
    input.feedback.trim(),
  ].filter(Boolean).join('\n');
}

export async function createFeedbackIssue(input: FeedbackInput): Promise<CreateFeedbackIssueResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
  if (!token || !repo) {
    return { ok: false, reason: 'not-configured' };
  }
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    return { ok: false, reason: 'not-configured', errorDetail: 'GITHUB_FEEDBACK_REPO must be "owner/repo"' };
  }

  const url = `https://api.github.com/repos/${repo}/issues`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'gc-curriculum-tool/feedback',
      },
      body: JSON.stringify({
        title: titleFromFeedback(input),
        body: bodyFromFeedback(input),
        labels: ['gc-feedback'],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: 'github-error', errorDetail: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    const data = await res.json() as { html_url: string; number: number };
    return { ok: true, issueUrl: data.html_url, issueNumber: data.number };
  } catch (err) {
    return { ok: false, reason: 'github-error', errorDetail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Document env vars**

In `.env.example`, under the "Auth / slug" section (or add a new "Feedback" block), append:

```bash
# In-app feedback widget — Phase 1 intake.
# Set both to enable. When unset, /api/feedback returns 503.
# GITHUB_TOKEN: PAT (classic or fine-grained) with repo scope on the target repo.
# GITHUB_FEEDBACK_REPO: "owner/repo" — where issues are created (typically the same repo).
GITHUB_TOKEN=
GITHUB_FEEDBACK_REPO=
```

- [ ] **Step 3: Type-check + commit**

Run: `pnpm tsc --noEmit` — clean.

```bash
git add lib/feedback/github.ts .env.example
git commit -m "feat(feedback): GitHub issue helper + env vars"
```

---

## Task 2: POST /api/feedback endpoint

**Files:** Create `app/api/feedback/route.ts`.

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { createFeedbackIssue } from '@/lib/feedback/github';

// Loose course-code extractor for routes like `/capture/GC 4800` (after URL decode).
const COURSE_CODE_RE = /\/(?:capture|explore)\/(GC\s+\d{4}[a-z]{0,2})/i;

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim().slice(0, 80) : null;
  const route = typeof body.route === 'string' ? body.route.slice(0, 200) : '(unknown)';

  if (feedback.length < 5) {
    return NextResponse.json({ error: 'feedback too short — please describe the issue or idea' }, { status: 400 });
  }
  if (feedback.length > 8000) {
    return NextResponse.json({ error: 'feedback too long — please keep under 8000 characters' }, { status: 400 });
  }

  // Course-code best-effort extract from the decoded route.
  let courseCode: string | null = null;
  try {
    const decoded = decodeURIComponent(route);
    const m = decoded.match(COURSE_CODE_RE);
    if (m && m[1]) courseCode = m[1].toUpperCase();
  } catch { /* keep null */ }

  const result = await createFeedbackIssue({
    name,
    feedback,
    route,
    courseCode,
    userAgent: req.headers.get('user-agent') ?? '(none)',
    capturedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    if (result.reason === 'not-configured') {
      return NextResponse.json(
        { error: 'feedback intake not configured on this deploy' },
        { status: 503 },
      );
    }
    console.error('feedback issue creation failed:', result.errorDetail);
    return NextResponse.json({ error: 'failed to file feedback' }, { status: 502 });
  }

  return NextResponse.json({ issueUrl: result.issueUrl, issueNumber: result.issueNumber });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm tsc --noEmit` — clean.

```bash
git add app/api/feedback/route.ts
git commit -m "feat(api): POST /api/feedback — slug-gated, rate-limited, GitHub-backed"
```

---

## Task 3: FeedbackWidget client component

**Files:** Create `app/FeedbackWidget.tsx`.

- [ ] **Step 1: Write the component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const NAME_KEY = 'gc-feedback-name';

/**
 * Floating feedback widget — appears bottom-right on every faculty page
 * (gated by URL `?slug=` presence, the same gate every faculty surface
 * already uses). Hidden on /partners/* and /preview/* automatically because
 * those routes don't carry the slug.
 *
 * The "Your name" field is encouraged (auto-fills from localStorage on
 * return visits) but optional — staying anonymous is allowed.
 */
export function FeedbackWidget() {
  const pathname = usePathname();
  const search = useSearchParams();
  const slug = search.get('slug') ?? '';

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ url: string; number: number } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
    }
  }, []);

  // Gate: hide on routes without a slug (partner/preview/unauth landings).
  if (!slug) return null;
  // Hide explicitly on partner/preview routes even if a slug somehow appears.
  if (pathname?.startsWith('/partners/') || pathname?.startsWith('/preview/')) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = text.trim();
      if (trimmed.length < 5) {
        setError('Please describe the issue or idea in a sentence or two.');
        return;
      }
      const route = (pathname ?? '') + (search.toString() ? `?${search.toString()}` : '');
      const res = await fetch(`/api/feedback?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          feedback: trimmed,
          route,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Failed (${res.status})`);
        return;
      }
      if (name.trim() && typeof window !== 'undefined') {
        window.localStorage.setItem(NAME_KEY, name.trim());
      }
      setPosted({ url: (json as { issueUrl: string; issueNumber: number }).issueUrl, number: (json as { issueUrl: string; issueNumber: number }).issueNumber });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setPosted(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="fixed bottom-4 right-4 z-40 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
      >
        💬 Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={reset}>
          <div
            className="w-full max-w-md rounded-lg border bg-card p-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Send feedback</h3>
              <button
                type="button"
                onClick={reset}
                className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
              >
                Close
              </button>
            </div>

            {posted ? (
              <div className="space-y-3">
                <p className="text-sm">Thanks — filed as <strong>#{posted.number}</strong>.</p>
                <p className="text-xs text-muted-foreground">
                  <a className="underline" href={posted.url} target="_blank" rel="noreferrer">View on GitHub</a> · You can keep working; we&apos;ll follow up.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setPosted(null); }} className="rounded border px-3 py-1.5 text-xs hover:bg-muted">Send another</button>
                  <button type="button" onClick={reset} className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium" htmlFor="fb-name">
                    Your name <span className="font-normal text-muted-foreground">(so we know who to follow up with — skip if you&apos;d rather stay anonymous)</span>
                  </label>
                  <input
                    id="fb-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Erica Walker"
                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium" htmlFor="fb-text">
                    What&apos;s on your mind? <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="fb-text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    rows={5}
                    placeholder="Bug, idea, confusion, anything. What page were you on and what were you trying to do?"
                    className="mt-1 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    required
                  />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    We&apos;ll capture the page you&apos;re on automatically.
                  </p>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit` — clean.

- [ ] **Step 3: Commit**

```bash
git add app/FeedbackWidget.tsx
git commit -m "feat(ui): faculty feedback widget — floating button + modal"
```

---

## Task 4: Mount in root layout + STATE update

**Files:** Modify `app/layout.tsx`, `docs/STATE.md`.

- [ ] **Step 1: Mount the widget**

Replace `app/layout.tsx` with:

```typescript
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FeedbackWidget } from './FeedbackWidget';
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
        {/* Widget self-gates on `?slug=` presence so it never renders on
            partner / preview / unauthenticated landings. Wrapped in Suspense
            so useSearchParams works during Next 15 streaming. */}
        <Suspense fallback={null}>
          <FeedbackWidget />
        </Suspense>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update STATE.md**

In `docs/STATE.md`:

1. Under "What's live → faculty surfaces" table (after `/program/scaffolding`), the widget is layout-mounted so it doesn't deserve a dedicated row — instead, add this as a new "Cross-cutting" section right after the faculty-surfaces table:

```markdown
### Cross-cutting

| Surface | What it does | Status | Shipped |
| ------- | ------------ | ------ | ------- |
| **`<FeedbackWidget />`** on every faculty page | Floating "💬 Feedback" button → modal (name + freeform) → `POST /api/feedback` → creates a GitHub Issue with auto-captured route/course-code/UA context. `gc-feedback` label. Phase 1 — Phase 2 adds scheduled Claude Code triage. | live | 2026-05-29 |
```

2. Under "Env vars → Auth / slug" (or create a new "Feedback" bullet):

```markdown
- **Feedback intake:** `GITHUB_TOKEN`, `GITHUB_FEEDBACK_REPO`
```

3. Bump `**Last verified:**` to the SHA of the next commit (placeholder for now — set after committing).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx docs/STATE.md
git commit -m "feat(layout): mount feedback widget + STATE"
```

---

## Verification (post-deploy, manual)

After `pnpm build && launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool`:

1. **Token not yet set** → submitting the widget returns "feedback intake not configured" — that's the loud-fail path. Set `GITHUB_TOKEN` + `GITHUB_FEEDBACK_REPO` in `.env.local`.
2. **Token set, fresh rebuild** → open `/capture/GC 4800?slug=…`, click the floating button, type a test sentence, submit. Expect: "filed as #N" with a clickable GitHub link.
3. **Open GitHub** → confirm the issue body has Route / Course / Captured / User agent + the typed text under `---`.
4. **Anonymous path** → submit without a name; issue body shows `From: _(anonymous)_`.
5. **Persistence** → name field auto-fills on the next session from localStorage.
6. **Gate** → load `/partners/<token>` or any URL without `?slug=` — the widget should be absent.

---

## Self-Review

**Coverage:** widget UX + modal (T3), name encouragement + localStorage persistence (T3), API endpoint with slug + rate-limit + length validation (T2), GitHub issue creation with structured body + label (T1), root-layout mount with Suspense (T4), env var documentation (T1) + STATE (T4). ✅

**Out of Phase 1 (deferred):**
- Screenshot upload (use a hosting like Vercel Blob; not required for Phase 1).
- Scheduled Claude Code triage on `issue.opened` — Phase 2 plan.
- Faculty identification beyond a free-text name (Clemson SSO is on the deferred deployment-planning track regardless).
- Inline severity / category dropdown — keep it freeform until we see what real reports cluster around.

**Tradeoffs noted:**
- `gc-feedback` label must exist in the repo for the API call to succeed. The first issue creation will fail if the label doesn't exist. Pre-create the label (`gh label create gc-feedback --color FBCA04 --description "Faculty feedback from the in-app widget"`) before testing.
- Storing only a free-text "name" means we can't easily merge multiple submissions by the same person. Acceptable for Phase 1's small-N trial.

---

## Execution Handoff

Plan complete. Saved to `docs/superpowers/plans/2026-05-29-feedback-widget-phase1.md`.

Recommended execution: tasks are linear and cheap; inline execution via superpowers:executing-plans is faster than subagent dispatch overhead here. Either works.
