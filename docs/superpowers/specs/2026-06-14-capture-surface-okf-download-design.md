# Capture-Surface OKF Download — Design

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Increment #1 of the two OKF fast-follows deferred in STATE.md after the portable-OKF-course-profiles ship. The operator wants faculty to be able to download a course's portable OKF markdown directly from the capture/review surface, not only from the public `/view/<code>` page.

## Decision made in the brainstorm (2026-06-14)

**The capture-surface button exports the LAST SAVED SNAPSHOT** — by linking to the already-shipped public `/view/[code]/okf` route. Rejected: exporting the in-progress DB draft (would need a faculty-tier route variant) and exporting the panel's current in-memory `working` state (would need client-side serialization or a POST endpoint). Rationale: the snapshot is the immutable, citable record; the public route already exists, is already PII-redacted, and is already what the operator considers the canonical portable projection. This collapses the increment to a UI-only change — zero new server code.

## What this builds

A "↓ Markdown" download affordance on the faculty `/capture/[code]` review surface (`ProfileReviewPanel`) that links to the public `/view/[code]/okf` route, shown only when a saved snapshot exists for the course (otherwise the route 404s).

## Components

### 1. `app/capture/[code]/page.tsx` — pass the snapshot-existence signal
The page already loads `latestSnapshot` (via `getLatestSnapshotByCourse(code)`) and derives `priorSnapshotInfo`. Add `hasSnapshot={latestSnapshot != null}` to the `<CaptureClient>` props. This is authoritative — it matches exactly when the `/okf` route returns 200 vs 404 (the route loads the same latest non-retired snapshot).

### 2. `app/capture/[code]/CaptureClient.tsx` — thread the prop
Accept `hasSnapshot: boolean` in `CaptureClient`'s props and pass it through to `<ProfileReviewPanel hasSnapshot={hasSnapshot} … />`.

### 3. `app/capture/[code]/ProfileReviewPanel.tsx` — render the link
- Add `hasSnapshot: boolean` to the `Props` interface.
- Compute one href constant: `const okfHref = ` + `http://130.127.162.180:3000/view/${encodeURIComponent(courseCode)}/okf`. This mirrors the file's existing absolute-LAN-origin `/view/<code>` links (see line ~1185) — chosen for consistency with the established convention in this file and so the downloaded file is the public LAN projection. (The `/view` *page* download link shipped in the portable-OKF increment uses a relative URL; the capture surface uses the absolute LAN origin to match its sibling links here. Reversible if it ever causes funnel-origin friction.)
- Show-predicate: `hasSnapshot || snapshotMessage?.kind === 'ok'`. `hasSnapshot` covers faculty returning to a course captured in a prior session; `snapshotMessage?.kind === 'ok'` covers the case where they just approved-and-captured in this session (a snapshot now exists even though it didn't at page load).
- Render `<a href={okfHref} download>↓ Markdown</a>` in two spots, both gated by the predicate, both reusing `okfHref`:
  1. **Header status row** (the `flex shrink-0` cluster next to the CAPTURED/DRAFT chip, ~line 1129) — persistent affordance for returning faculty. Styled as a subtle text/border link matching the adjacent "← Back to the interview" control.
  2. **Post-snapshot success-card action row** (~line 1183, alongside "View the public profile →" / "See the program matrix" / "Back to the course list") — discoverability at the moment of capture. Styled as a button matching that row.

### `download` attribute note
Cross-origin browsers ignore the `download` attribute, but the `/view/[code]/okf` route sets `Content-Disposition: attachment; filename="<slug>.md"`, so the file downloads regardless — identical behavior to the shipped `/view` page link.

## What is explicitly UNCHANGED
- The public `/view/[code]/okf` route and `profileToOkfMarkdown` serializer — reused as-is, untouched.
- PII redaction — the route already applies `redactPiiDeep`; no redaction logic on the capture surface.
- The snapshot save flow, profile schema, snapshots route — untouched.
- The `/view` page download link (Piece 1 / portable-OKF) — untouched.

## Out of scope (deferred / non-goals)
- **In-progress DB draft export** — rejected this brainstorm (chose last-saved snapshot).
- **Current in-memory `working`-state export** — rejected (most code, least value given the snapshot is the citable record).
- **Wiki-frontmatter OKF-v0.1 alignment** — Increment #2, its own brainstorm → spec → plan cycle.
- **Whole-curriculum OKF bundle zip** — longer-term deferred (STATE.md).

## Testing
- **`ProfileReviewPanel` (RTL):** render with `hasSnapshot={true}` → a "↓ Markdown" link is present with `href` ending `/view/<encoded-code>/okf`. Render with `hasSnapshot={false}` (and no successful snapshot) → no "↓ Markdown" link. (The post-capture success path is covered by the OR predicate; the `hasSnapshot` prop path is the unit-testable surface without mocking the snapshot fetch.)
- **Full suite** stays green (`pnpm test`).
