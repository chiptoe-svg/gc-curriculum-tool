# Roadmap — GC Curriculum Tool

The forward-looking plan. `STATE.md` is the record of what is and what was decided; this is
what could be and what we intend. Items move from here to STATE.md when they ship or are
deferred with a reason. Rendered live at `https://gcworkflow.clemson.edu:8443/board/curriculum/`.
Seeded 2026-09-26 from STATE.md's Next-up and the September IT arc; edit freely.

## Vision

A living record of the Graphic Communications curriculum that answers two questions with
evidence rather than catalog copy: how well the program builds students toward the careers it
claims to prepare them for (Q1), and whether each course's prerequisites actually support what
it expects (Q2). Faculty capture what students really do; the tool scores it on know /
understand / do; the wiki and the program views make the result readable to anyone on campus.

## Themes

1. **Evidence over aspiration** — every score traceable to a student-side artifact.
2. **The employer → curriculum loop** (Q1) — partner demand scored against course coverage.
3. **Prerequisite honesty** (Q2) — gaps between what a course assumes and what feeds it.
4. **A public record** — the wiki as the department's readable, linked curriculum map.
5. **Campus identity and hosting** — real logins, CCIT-hosted, so access is by role and the
   Mac stops being infrastructure.

## Planned (committed, roughly in order)

| What | Why | Size | Depends on |
|---|---|---|---|
| CCIT hosting on RHEL 8 with a Shibboleth SP (curriculum tool, schedule/catalog MCPs, COB advisor) | Real identity + role gating; service-account separation and FileVault stop being Mac problems | L | CCIT VM + SP registration; attribute release (`eduPersonAffiliation`) |
| Controlled reboot + privileged PF readback for CCIT's verification list | Closes the last open host item from the three assessments | S | owner at console |
| Wiki article pages for every captured course; keep the index and articles in the same design system | The public record is the department's front door | done 2026-09-25 | — |
| Arc A step 4 — demand half of the unified demand/coverage layer (built-ahead, flag-gated, not activated) | Q1 spine: partner-weighted demand against coverage | M | activation decision; partner survey volume |
| Evidence-ladder program rollup (claimed vs materials-supported counts in the matrix) | Makes the evidence floor visible at program scale | M | per-cell source/citations through the matrix API |
| Restore test of the off-host backups (isolated) | The monitor proves freshness, not recoverability | S | a scratch Postgres + the share |

## Possible (worth keeping; not scheduled)

- **CSP for the web apps** — the last header CCIT flagged; needs app-side nonces. Why not yet: breaks inline scripts in the capture flow and the advisor until done carefully.
- **Backup monitor also runs `wiki:lint`** and reports a change in broken-link count. Cheap; low urgency because links self-heal as courses are captured.
- **Department-wide dashboard index across projects** (curriculum, gcdept agents, alumni, advising MCPs, hosting). The per-project pages exist first.
- **Phase 1B Scaffolding stage 2 / Phase 1D advising view** — program analytics beyond the matrix. Why not yet: Arc A first.
- **Spoken-interview capture (voicelab findings)** — direct-audio works only on Gemma 4 E2B/E4B/12B. Why not yet: depends on whether Position Capture page 6 wants it.
- **Diagnostic constraint modeling** (GC-specific troubleshooting condition, JSON on `productive_failure_conditions`). Small; waits for a capture that needs it.

## Outstanding issues (known, not scheduled)

| Symptom | Impact | Workaround |
|---|---|---|
| Wiki regeneration fails when the RCD OpenAI passthrough pool is exhausted (429), and nothing retries | A newly approved course has no wiki page until someone re-runs it | Manual retry script (done for GC 3730 on 2026-09-25); pool appears to refill monthly |
| 9 forward-reference wikilinks to courses not yet captured | Rendered as inline code, not links | Self-heals when those courses are captured |
| Backend services (Next, MCPs, advisor, Postgres) still run as `admin` | Same-user compromise scope; recorded as accepted debt on the Mac | Loopback-only binds; full separation is one line per unit on the IT host |
| 134 GB of Apple `container` snapshots on the Mac | Disk headroom (308 GB free after the 2026-09-22 cleanup) | GC_Agent asked to prune |
| `STATE.md` says the deploy runs `next dev`; it runs `next start` | Misleading to a new session | Noted in Deferred/debt; fix on next STATE refresh |

## Decisions pending

| Question | Options | Who decides | Default if no answer |
|---|---|---|---|
| FileVault on a headless server | (a) FileVault off + auto-login + immediate screen lock + physical control (current); (b) FileVault on + a named unlocker + outage after every reboot; (c) CCIT hosting makes it moot | owner + CCIT | (a), documented |
| MDM/EDR enrollment of the Mac | enroll with server-appropriate exceptions (no forced restarts, no forced FileVault, allow-list for caddy-cf/Homebrew/OrbStack) vs. decline and move to CCIT hosting | owner + CCIT | conditional yes |
| Disk size on the CCIT VM | 100 GB if it can be grown online; 200 GB otherwise | CCIT | 100 GB |
| Big-picture source | this file as the planning layer (current) vs. rendering STATE.md's forward sections | owner | this file |
