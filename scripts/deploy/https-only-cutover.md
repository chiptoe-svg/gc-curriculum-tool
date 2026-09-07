# HTTPS-only cutover runbook — retiring cleartext `:3000`

**Status: STAGED, not executed.** Blocked on step 0.
**Written 2026-09-07.** Companion config: [`http-signpost.caddy`](./http-signpost.caddy).

## Goal

`https://gcworkflow.clemson.edu:8443` (Caddy + InCommon cert) becomes the only
way to reach the app from the network. Next binds loopback; Caddy takes over the
freed `:3000` and answers cleartext with a signpost instead of the application.

**What this does not do:** remove HTTP from the app. Caddy terminates TLS and
speaks cleartext to `127.0.0.1:3000` — that hop always exists. What goes away is
HTTP *reachable from the network*.

---

## Step 0 — BLOCKER: migrate the agent consumers

`gcdept_agents` has 8 gc-wiki groups pointing at `http://host.docker.internal:3000/api/mcp`,
which their runner rewrites to the vmnet bridge `192.168.64.1:3000`. **Binding
Next to loopback removes that address**, so they break unless migrated first.

- Target: `https://gcworkflow.clemson.edu:8443/api/mcp` (bearer unchanged).
- Verified working from inside their container image: DNS → `130.127.162.67`;
  401 with `ssl_verify_result=0` on both the direct path and via the OneCLI
  gateway proxy `192.168.64.1:10255`. The InCommon chain is accepted by the
  container CA bundle with no extra config.
- Owned by the `gcdept_agents` session, not this repo. Operator approved
  2026-09-07.

**Do not proceed until that session confirms with a trace showing a real wiki
call over 8443.**

## Step 1 — drop the `/api/*` exemption in middleware

`middleware.ts` currently exempts `/api/*` from the HTTP→HTTPS interstitial so
agents keep working. Once step 0 lands, replace the exemption with a
machine-readable **426** (JSON, never HTML — an MCP client cannot follow a page).
Keep the interstitial HTML for browser paths.

## Step 2 — move Next to loopback

1. `package.json`: add `"start:local": "next start --hostname 127.0.0.1"`.
2. `~/Library/LaunchAgents/com.gc.curriculum-tool.plist`: `ProgramArguments`
   `pnpm start:lan` → `pnpm start:local`.
3. `launchctl bootout gui/501/com.gc.curriculum-tool && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.gc.curriculum-tool.plist`

Verify: `curl http://127.0.0.1:3000/` → 200; `curl http://130.127.162.67:3000/`
→ connection refused.

## Step 3 — Caddy takes over `:3000`

**Order matters: only after step 2.** Caddy cannot bind a port Next still holds,
and a Caddyfile that fails to load takes the HTTPS site down with it — turning a
tidy-up into a total outage.

1. `cat scripts/deploy/http-signpost.caddy >> ~/.config/caddy-gc/Caddyfile`
2. Validate BEFORE reloading — this is the step that prevents the outage:
   ```
   set -a; . ~/.config/caddy-gc/cf.env; set +a
   ~/.local/bin/caddy-cf validate --config ~/.config/caddy-gc/Caddyfile --adapter caddyfile
   ```
   Must print `Valid configuration`. (Verified 2026-09-07 against the then-current
   Caddyfile: valid.)
3. `launchctl kickstart -k gui/501/com.gc.caddy-tls`

Verify: `http://130.127.162.67:3000/capture/GC%203800` → signpost page linking to
the same path on 8443; `http://130.127.162.67:3000/api/mcp` → 426 JSON;
`https://gcworkflow.clemson.edu:8443/` → 200 (unchanged).

## Step 4 — optionally close the bridge address

Uncomment the `192.168.64.1:3000` block in `http-signpost.caddy` so a stale
container gets a loud 426 rather than a silent cleartext success. Only after
step 0 is confirmed.

## Step 5 — housekeeping

- `~/.dev-ports.yaml`: `next_dev: 3000` note still says `0.0.0.0 (LAN)`; it also
  carries a **stale** claim that agents call `http://gcworkflow.clemson.edu:3000/api/mcp`
  (they use the bridge — that entry was written for the retired nanoclaw_classroom
  and misled this work once already).
- `CLAUDE.md` / `docs/STATE.md`: record loopback-only.
- Faculty comms: the published entry point becomes
  `https://gcworkflow.clemson.edu:8443`.

---

## Risks accepted

| Risk | Mitigation |
| --- | --- |
| Caddy becomes a single point of failure — today HTTP still serves if it dies | Watchdog now probes the real TLS path and kickstarts `com.gc.caddy-tls` (added 2026-09-07) |
| InCommon cert is **manual-renewal, expires 2027-01-21**; after cutover an expired cert is a total outage, not a degraded path | Watchdog warns daily from 30 days out; calendar reminder set for 2027-01-05 |
| `:8443` in the URL is awkward to type | Optional `pf` redirect 443→8443; not done (macOS non-root can't bind <1024) |
| Partner/employer surveys | Already broken by campus-only — unrelated to this cutover, tracked separately in STATE Deferred/debt |
