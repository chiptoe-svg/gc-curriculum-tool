# Response to the host security posture assessment — gcworkflow.clemson.edu

Clemson Graphic Communications · 22 September 2026 · same-day remediation

## Summary

All host-side findings that can be addressed without CCIT involvement have been remediated today. The externally reachable surface is now **TCP 8443, 8444 (HTTPS via Caddy), 22 (SSH, key-only), and 5900 (Screen Sharing, admin only)**. Everything else is bound to loopback or removed. The macOS Application Firewall is enabled with stealth mode.

## Findings and actions

| Priority | Finding | Action taken | Status |
|---|---|---|---|
| P0 | Weaviate gRPC/profiler/cluster ports wildcard-bound; PF guardrail unverified | (1) Verified PF: enabled 31 days, `gc-weaviate-block` anchor loaded, six `block drop in quick on en0` rules live, hit counters show the 6060 rule has already dropped probe packets. (2) **Structural fix:** Weaviate moved into a container with ports published only on `127.0.0.1:8090` and `127.0.0.1:50051`. Ports 6060, 7946, 7947, 8300, 8301 no longer exist on the host. Data verified identical before/after (11 classes, 43 tenants, 10 object counts). Upstream issue weaviate/weaviate#5898 (gRPC ignores `--host`) is still open, so a config-only fix was not available. | **Closed** |
| P1 | Application Firewall disabled | Enabled, stealth mode on. Explicit allow entries added for the ad-hoc-signed reverse proxy and the Node/Python/Caddy runtimes. Note: stealth mode means the host will not answer ICMP and closed ports read as filtered in an external scan. | **Closed** |
| P1 | Caddy listeners on 8009, 3000, 8088 (cleartext) and 8443/8444 | Cleartext listeners `:3000` (HTTPS-upgrade signpost), `:8088` (503 placeholder) and `:8009` (redirect) **removed**. 8443 and 8444 remain: both TLS with the CCIT-issued InCommon certificate; 8443 fronts all department services by path, 8444 the alumni review app. Authentication is per service (Basic Auth / app login / bearer tokens) pending the SSO discussion. | **Closed** (8443/8444 intended) |
| P1 | Course Demand Planner on `:3020`, all interfaces, no TLS | Rebound to `127.0.0.1`; now served only at `https://gcworkflow.clemson.edu:8443/gc-demand/`. | **Closed** |
| P2 | ControlCenter on 5000/7000 | AirPlay Receiver turned off; listeners gone. | **Closed** |
| P2 | Caddy `:3021`, Python `:8023` | `:3021` (recruiting page) rebound to `127.0.0.1`, served at `…:8443/recruiting/`. `:8023` was an orphaned `python -m http.server`; terminated. | **Closed** |
| P2 | Remote-access group membership; SSH/VNC state unverified | Verified with root-visible socket listing (non-root `lsof` cannot see launchd-owned sockets, which is why both this and the audit snapshot missed them). **Remote Login: on, hardened** — `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers admin`, `MaxAuthTries 3`, `LoginGraceTime 30`; password login tested and refused. **Screen Sharing: on**, restricted to the admin account. **File Sharing: off** (445 no longer listening). Remote Management, Remote Apple Events: off. | **Closed** |
| — | (not in report) Container runtime default | OrbStack `expose_ports_to_lan` set to `false` for both Docker and machines, so future containers default to loopback. Applied; OrbStack restarted. | **Closed** |

## Second assessment (12:18–12:23 EDT) — additional findings and actions

| Priority | Finding | Action taken | Status |
|---|---|---|---|
| High | CUassistant off-host backup `SKIPPED share unwritable` since creation | Root cause found and reproduced: macOS grants "Network Volumes" access per responsible executable; the job ran under `/bin/zsh`, which lacked the grant, while `/bin/bash` (used by the working curriculum backup) has it. The launchd job now launches through `/bin/bash`; first scheduled-context run logged `backup=OK` to `/Volumes/gc-pks/gc_backups/cob-advisor/gcworkflow`. The share itself was mounted and writable throughout; the curriculum and alumni backups had been succeeding daily. | **Closed** |
| High | OS patch lag (26.1 → 26.7 available) | To be applied at a maintenance window; all services return automatically after reboot (launchd + OrbStack restart policies verified). | **Scheduled** — owner |
| High | FileVault off | Decision required with CCIT — see "Items requiring CCIT". Headless server: FileVault on means no service returns after a reboot until someone unlocks at the console. | **Open — CCIT** |
| Medium | TCP 53, 88, 5900 reachable; wildcard 443 | **443:** was a residual Tailscale `serve` rule left from the 2026-09-07 Funnel retirement; Tailscale is now logged out and uninstalled — listener gone. Its network system extension remains loaded but inert until the next reboot (`systemextensionsctl uninstall` requires SIP off, which we will not do); macOS removes orphaned extensions at boot. **53:** Apple `mDNSResponder` acting as DNS proxy for Internet Sharing, which the Apple `container` runtime's bridge depends on; it never answered on the campus interface, and is now additionally blocked on `en0` in pf (TCP+UDP). **88:** Apple local KDC, tied to Screen Sharing (Kerberos auth); stays while Screen Sharing is on. **5900:** Screen Sharing, intended, admin only. | **Closed** (53/88/5900 intended; 443 removed) |
| Medium | Services share the `admin` account; passwordless `pfctl` | Accepted for now on a single-operator departmental box; recorded as debt. The `pfctl` exception exists for the pf anchor load and can be narrowed to `pfctl -a gc-weaviate-block -f /etc/pf.anchors/gc-weaviate-block` or removed (the anchor also loads from `/etc/pf.conf` at boot). Service-account separation is the strongest argument for CCIT hosting (see Hosting Requirements). | **Deferred** — documented |
| Medium | No MDM / EDR | Decision required with CCIT — see below. | **Open — CCIT** |
| Low | Missing security headers; server disclosure | `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` added on 8443 and 8444; `Server` and `X-Powered-By` stripped. All routes verified unchanged. CSP deferred: the Next.js app and the advisor need an app-side nonce policy first. | **Closed** (CSP deferred) |
| Low | `.ssh` 0755 | Now 0700. | **Closed** |

Current externally reachable surface: **22 (key-only), 5900 (admin only), 8443, 8444**. Ports 53 and 88 accept a TCP handshake but 53 is pf-blocked on `en0` and 88 is the local KDC.

## Third assessment (13:22–13:24 EDT, post-reboot) — findings and actions

| Priority | Finding | Action / position | Status |
|---|---|---|---|
| High | Administrator auto-login with FileVault off | **Deliberate, documented.** Headless server: every service is a user-level launchd agent, so without auto-login nothing serves after a reboot until someone reaches the console. Mitigations in place: screen lock is set to *immediate* (`sysadminctl -screenLock status`), Screen Sharing restricted to admin, SSH key-only. This is the same decision as FileVault (FileVault on = no auto-login) and we are asking CCIT to make it once, for both — see below. Physical control of the Mac Studio's location is the compensating control. | **Open — CCIT decision** |
| Medium | Custom PF anchor absent after reboot | Cause confirmed: the macOS 26.7 update replaced `/etc/pf.conf`, dropping the `load anchor` line (standard macOS behaviour; the anchor file survived). Fix: a root LaunchDaemon (`edu.clemson.gc.pf-anchor`) that runs `pfctl -a gc-weaviate-block -f /etc/pf.anchors/gc-weaviate-block` at every boot, independent of `/etc/pf.conf`. Residual value is small — Weaviate is loopback-only since noon — but it keeps the port-53 block enforced and the control update-proof. | **Fix prepared; applied at next admin session** |
| Medium | Skipped backups return exit 0 | `scripts/backup-offbox.sh` now exits **75 (EX_TEMPFAIL)** on the unwritable-share branch; verified: forced-unwritable → 75, real run → `backup=OK` / 0. `launchctl list` now shows a nonzero last-exit for a skipped window. Backup age monitoring remains a follow-up. | **Closed** (alerting follow-up open) |
| Medium | 88 / 5900 network scope | 88 is the local KDC that Screen Sharing's Kerberos auth requires; 5900 is Screen Sharing itself, admin only. Both are the administrative-access path for a headless box; the intended boundary is campus/VPN, which is CCIT's perimeter rule. We are not able to narrow further host-side without losing remote administration. | **Policy — CCIT perimeter ACL** |
| Medium | 53 inconclusive | Attributed on-host with root `lsof`: `mDNSResponder` acting as DNS proxy for Internet Sharing (the Apple `container` bridge). Never answered on the campus interface; pf-blocked on `en0` once the anchor loader above is in place. | **Closed** once anchor loader active |
| Medium | Shared admin identity; `pfctl` NOPASSWD | The `pfctl` sudoers exception (`/etc/sudoers.d/claude-pfctl`) becomes unnecessary once the LaunchDaemon owns the anchor load and will be removed in the same admin session. Service-account separation: deferred, documented; strongest argument for CCIT hosting. | **pfctl: closing; separation: deferred** |
| Medium | MDM / EDR / central logging | CCIT decision. | **Open — CCIT** |
| Low | Safari 27 / Command Line Tools updates; CSP | CLT 26.6 and Safari 27.0 to be applied with the next maintenance. CSP deferred (application nonce work). | **Scheduled / deferred** |
| — | Automatic restart after power loss: off | Turning on (`pmset -a autorestart 1`) — with auto-login this makes the box fully self-recovering after a power event. | **Applied at next admin session** |

Post-reboot verification (13:30 EDT): all HTTPS routes serving, three containers healthy, container-bridge listeners present, agent runner running, auto-login brought every service back without intervention.

## Items requiring CCIT

| Item | Request |
|---|---|
| External verification | Please scan from an independent network against this allowlist: **8443, 8444, 22, 5900**. Expect everything else filtered (stealth). |
| Perimeter ACL | Please restrict inbound to this host to those four ports from campus/VPN ranges, so host configuration is not the only control. |
| FileVault + auto-login (one decision) | Headless, always-on server with no on-site operator. Two consistent configurations exist: **(a)** FileVault off + administrator auto-login + immediate screen lock + physical access control (current); **(b)** FileVault on, no auto-login, and a named person who unlocks the console after every reboot/update, accepting the outage until they do. We need CCIT to choose (a) or (b) — or (c) CCIT hosting per the Hosting Requirements document, which makes the question moot. |
| MDM enrollment | Open to discussion; please advise what enrollment implies for a server-role Mac operated by a department. |
| Security updates | `softwareupdate -l` to be run and any pending updates applied at the next maintenance window. |

## Maintenance window / operator

The department owner (admin account) applied today's changes and can act as operator for any further CCIT-specified changes. For changes CCIT wishes to apply directly (PF ruleset, FileVault, MDM), please propose a window; weekday evenings are preferred.
