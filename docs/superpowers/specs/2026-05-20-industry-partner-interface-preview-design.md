# Industry Partner Interface Preview — Design

**Date:** 2026-05-20
**Status:** Approved for planning

## Purpose

The pilot announcement (`docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html`)
describes the Industry Partner Input tool but gives the reader no way to *see* what
industry partners actually experience. The live employer interface lives at
`/partners/[token]` and requires a magic token, a database session, and a running
server — none of which a reader of a static announcement doc has.

This project delivers a **self-contained, interactive preview** of the employer
interface: a single static HTML file that recreates the partner survey screens, lets
the reader click through and type into them, and is linked directly off the pilot
announcement.

## Goals

- A reader of the pilot doc can open one link and walk the full partner experience.
- The preview is faithful to the real interface — it reuses the real components'
  actual Tailwind classes, so it matches pixel-for-pixel and cannot drift on styling.
- The preview is self-contained: no server, no database, no auth, no build step.
  It travels with the pilot doc as a sibling file.
- It is unmistakably a *preview*, not the live tool.

## Non-Goals

- No real persistence, network calls, email, or magic-link auth.
- No server-error simulation (e.g. the real app's `alert('Save failed')`).
- No automated test suite — this is a docs artifact, not application code.
- No changes to the live `/partners/[token]` app.

## Approach

A single self-contained HTML file using the **Tailwind Play CDN**
(`<script src="https://cdn.tailwindcss.com">`). The live app is styled entirely with
default Tailwind utility classes (`partner-shell.css` is empty), so loading the same
Tailwind and copying the utility classes verbatim from each component guarantees a
faithful match. The pilot HTML already loads fonts from a CDN, so a CDN dependency is
a consistent assumption.

Screens are sibling `<div>`s; only one is visible at a time, toggled by a small
vanilla-JS state machine. No framework, no bundler.

## File & Location

- **New file:** `docs/superpowers/pilot/2026-05-20-industry-partner-interface-preview.html`
  — placed beside the pilot announcement so the cross-link is a bare filename.

## Linking From the Pilot Announcement

Edit `docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html`:

1. **Rail "Related" group** — add a nav link:
   `<a class="nav-link" href="2026-05-20-industry-partner-interface-preview.html">Interface preview</a>`
2. **Section 02 "What's live"** — add a `.callout` after the feature cards with a CTA
   linking to the preview, e.g. *"Click through the interface partners see →"*.

These are the only edits to the existing pilot file.

## Layout

Two stacked regions:

### 1. Preview frame (chrome — not part of the real app)

A visually distinct dark bar at the top, styled so no reader mistakes it for the
survey itself. Contains:

- `← Back to pilot announcement` link (to the pilot HTML).
- A **view toggle**: `First visit` / `Returning visit`.
- A `Restart` control that resets all in-memory state.
- The note: *"Sample data — nothing here is saved."*

### 2. The survey shell (faithful recreation)

Recreates `app/partners/[token]/layout.tsx` verbatim:

- Header: "Clemson Graphic Communications" / "Industry Partner Survey" /
  "Thanks for your time."
- Main content area (holds the active screen).
- Footer: "Your responses go directly to the GC faculty curriculum committee."

## Screen States

Six screens, recreated from the live components, one visible at a time:

| # | Screen | Source component |
|---|--------|------------------|
| 1 | Welcome | `WelcomeScreen.tsx` |
| 2 | Wizard step 1 — career-target picker | `CareerTargetPicker.tsx` + `SubmissionWizard` progress bar |
| 3 | Wizard step 2 — position form | `PositionForm.tsx` + progress bar |
| 4 | Wizard step 3 — confirmation | `SubmissionConfirmation.tsx` + progress bar |
| 5 | Dashboard (returning visit) | `PartnerDashboard.tsx` + `SubmissionsList.tsx` |
| 6 | Done | `done/page.tsx` |

### Screen 1 — Welcome

Greeting ("Hi Dana — thanks for being here."), the headline, the intro paragraph, and
two cards: "Describe a position you hire for" (live — advances to screen 2) and "Rate
student projects" (greyed/dashed, inert, "Coming soon").

### Screen 2 — Career-target picker

Three-step progress bar (step 1 active). A 2-column grid of the **5 real seeded
career targets**, copied from `lib/domain/seed-targets.ts`:

1. **Account Management**
2. **Brand Strategy**
3. **Production & Operations**
4. **Creative Generalist / AI-Native**
5. **AI Workflow / Orchestrator**

Each card shows the target `name`, `shortDefinition`, and `industryContexts` rendered
as tag chips. Clicking a card selects it (highlighted border). A dashed-border escape
hatch — "None of these quite fit — let me describe it" — reveals a free-text input.
"Continue →" is disabled until a card is selected *or* the escape-hatch input has
non-empty text (mirrors `canContinue`).

### Screen 3 — Position form

Progress bar (step 2 active). "Save draft" button in the header. Four bordered
sections, copied from `PositionForm.tsx`:

- **Position basics** — Job title (required), Responsibilities (textarea).
- **Compensation (optional)** — Low / High number inputs, Currency select
  (USD/CAD/EUR/GBP).
- **What you look for** — Required skills and Nice-to-have skills, each a tag input
  (Enter or blur to add a chip, × to remove).
- **How you screen** — Interview questions as repeatable text rows
  (+ add another / remove), plus an "Anything else worth knowing" textarea.

Footer: "← Back", "Save draft", "Submit". Submit is disabled until Job title is
non-empty (mirrors `canSubmit`).

### Screen 4 — Confirmation

Progress bar (step 3 active). "Got it — thank you. We've recorded **[title]**."
Three actions: "Add another position" (resets the form, returns to screen 2),
"See my submissions" (→ dashboard), "I'm done" (→ done screen).

### Screen 5 — Dashboard (returning visit)

"Welcome back, Dana (Meridian Brand Co.)." Three cards: Positions (with
submitted/draft counts, "Add another position" → screen 2), Project ratings
(disabled), "I'm done for now" (→ done). Below: "Your submissions" — the submissions
list with Draft (amber) / Submitted (green) badges, "Resume" on drafts, "Delete" on
every row.

### Screen 6 — Done

"Thank you." paragraph. Reachable from the dashboard and the confirmation screen.

## Interactivity

An editable sandbox driven by a small vanilla-JS state machine. All state is
in-memory; reloading the page resets everything.

### State shape

- `screen` — which of the six screens is visible.
- `wizardStep` — 1 | 2 | 3 within the wizard.
- `targetId` / `unmappedLabel` — career-target selection (mutually exclusive,
  mirrors the real `onPick` / `onUnmapped`).
- `values` — the position-form fields (title, responsibilities, salary low/high,
  currency, requiredSkills[], niceToHaveSkills[], interviewQuestions[],
  additionalNotes).
- `submissions` — array of `{ id, positionTitle, status: 'draft' | 'submitted',
  updatedAt }`.

### Behaviors (mirroring the real client logic)

- **Picker:** clicking a target highlights it and clears any escape-hatch label;
  typing in the escape hatch clears the target selection. Continue gating per
  `canContinue`.
- **Form:** every input is typeable; tag inputs add a chip on Enter or blur and
  remove on ×; interview-question rows add/remove. Submit gating per `canSubmit`.
- **Save draft:** inserts or updates a `draft` entry in `submissions`.
- **Submit:** inserts a `submitted` entry, advances to the confirmation screen.
- **Confirmation actions:** "Add another" clears `values` + selection and returns to
  wizard step 1; the other two navigate to dashboard / done.
- **Dashboard:** the submissions list renders `submissions`; "Resume" on a draft
  re-hydrates `values` and opens wizard step 2; "Delete" removes the entry (no
  `confirm()` dialog needed in the preview — it just removes).

### View toggle (preview frame)

- **First visit** → opens screen 1 (Welcome) with an empty `submissions` array.
- **Returning visit** → opens screen 5 (Dashboard) with `submissions` pre-seeded
  with one `submitted` and one `draft` sample entry, so the dashboard looks
  realistic on arrival.
- **Restart** resets to the First-visit state.

## Sample Data

- **Partner:** first name "Dana", company "Meridian Brand Co." (used in greetings).
- **Career targets:** the 5 real seeded targets, names/definitions/contexts copied
  from `lib/domain/seed-targets.ts`.
- **Pre-seeded submissions** (returning-visit view): one submitted
  (e.g. "Junior Account Coordinator") and one draft (e.g. "Print Production
  Assistant").

## Verification

Manual, since this is a docs artifact:

1. Open the file in a browser.
2. First visit: Welcome → pick a target → fill the form → Submit → confirmation
   shows the typed title → "See my submissions" → dashboard lists the submission.
3. Exercise the escape hatch, tag inputs, repeatable rows, and disabled-button
   gating.
4. Returning visit toggle: dashboard shows the pre-seeded submissions; Resume
   re-hydrates a draft; Delete removes a row.
5. Confirm the rail link and the §02 callout in the pilot HTML both open the
   preview.
6. Screenshot each screen.
