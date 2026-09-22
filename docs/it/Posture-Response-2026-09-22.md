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

## Items requiring CCIT

| Item | Request |
|---|---|
| External verification | Please scan from an independent network against this allowlist: **8443, 8444, 22, 5900**. Expect everything else filtered (stealth). |
| Perimeter ACL | Please restrict inbound to this host to those four ports from campus/VPN ranges, so host configuration is not the only control. |
| FileVault | Currently off. This is a headless, always-on server: with FileVault on, it does not return after a power loss or reboot until someone unlocks it at the console. We need CCIT's guidance on whether that trade-off is acceptable or whether an alternative (e.g. hosting on CCIT infrastructure — see the separate Hosting Requirements document) is preferred. |
| MDM enrollment | Open to discussion; please advise what enrollment implies for a server-role Mac operated by a department. |
| Security updates | `softwareupdate -l` to be run and any pending updates applied at the next maintenance window. |

## Maintenance window / operator

The department owner (admin account) applied today's changes and can act as operator for any further CCIT-specified changes. For changes CCIT wishes to apply directly (PF ruleset, FileVault, MDM), please propose a window; weekday evenings are preferred.
