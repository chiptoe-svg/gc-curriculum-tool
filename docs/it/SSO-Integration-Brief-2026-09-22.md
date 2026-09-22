# SSO Integration Brief

Departmental apps and MCP servers on `gcworkflow.clemson.edu` — Clemson Graphic Communications
Prepared for the CCIT identity discussion, 22 September 2026

## Summary

We want to replace a shared faculty password and static bearer tokens with Clemson identities, so that access to several departmental web apps and MCP servers can be gated by role (faculty / staff / student). The host is already campus- and VPN-only. We are asking for one OIDC relying party on the Clemson Login Service, release of an affiliation attribute, and a decision on dynamic client registration for MCP clients.

---

## 1. What we are telling you

### 1.1 What it is

A department-owned Mac hosting several Graphic Communications services behind one Caddy reverse proxy at `https://gcworkflow.clemson.edu:8443` (CCIT-issued InCommon certificate). All services are reached as paths under that single hostname:

- **GC Curriculum Tool** — Next.js web app (curriculum mapping and analysis)
- **cob_advisor** — web app
- **MCP servers** used from Claude Desktop / Claude Code / Cursor: `/mcp/clemson_catalog`, `/mcp/clemson_schedule`, `/mcp/gc_careers`, `/mcp/gc_wiki`, with more expected

### 1.2 Exposure

Campus network and VPN only, already enforced by CCIT at the network. No public path exists or is wanted.

### 1.3 Who logs in

| Population | Access |
|---|---|
| GC faculty and staff | Primary users — full access to their department's tools |
| GC students | Read-only views now; some interactive features later |
| Other Clemson faculty | Read-only |
| Industry partners | External. Stay on the existing magic-link survey — no SSO involvement |

### 1.4 What we need from the identity assertion

A stable identifier (`eppn` / `sub`), name, email, and **affiliation** (faculty / staff / student). Ideally also department and a GC-faculty / GC-major group. Today a shared password gates faculty pages and the MCP servers use static bearer tokens; we want per-person identity so that access is gated by role, per app and per MCP server.

### 1.5 Data classification

Curriculum structure, syllabi, faculty interview transcripts, industry-partner survey responses, alumni career destinations, and public Banner catalog/schedule data. **No grades, no student records.** Once students log in we will store only identifier + affiliation + role.

### 1.6 Integration shape: one relying party, many apps

A single SSO integration point — an auth gateway or a local OAuth broker — in front of Caddy will perform login for every app and MCP server on the host. CCIT registers one relying party; adding apps later is a local configuration change on our side.

### 1.7 Our preference

An OIDC relying party on `idp.app.clemson.edu` (the Clemson Login Service — it already speaks OIDC, and Workday authenticates there). Fallback: a SAML SP on the same IdP. Last resort: an Entra ID app registration.

### 1.8 What we have already verified from outside

- `idp.app.clemson.edu` publishes OIDC discovery: `authorization_code` + `refresh_token` grants, a `registration_endpoint`, no PKCE advertised, no affiliation claim advertised
- `clemson.edu` Microsoft 365 is federated to `adfs.clemson.edu`
- Entra tenant `0c9bf8f6-ccad-4b87-818d-49026938aa97`

---

## 2. What we are asking

### A. Network boundary (already campus/VPN-only)

1. Does campus-only placement put us in a lighter security-review tier?
2. Can the rule be tightened to **ports 22, 80, 443 and 8443 only**? Everything we serve sits behind Caddy on 443/8443 (80 is only for HTTP→HTTPS redirect). Campus-only is a subnet filter — anyone on campus could reach a stray service port directly and bypass the SSO gateway. A port-level ACL closes that at the network regardless of local configuration, and makes any future accidental bind closed by default.

### B. Web app SSO

1. Can you register an **OIDC relying party on `idp.app.clemson.edu`**? Intake process, owner, turnaround.
2. One relying party will front multiple apps and MCP servers on this host. Is that acceptable, or do you require per-application RPs for attribute-release auditing?
3. Redirect URI: `https://gcworkflow.clemson.edu:8443/api/auth/callback/clemson`. Can the RP hold **multiple redirect URIs**, and can one be added later (a broker callback) without re-intake? Any objection to the non-443 port? (Nice-to-have: 443 on this host.)
4. **Which attribute encodes affiliation, and will you release it?** `eduPersonAffiliation` / `eduPersonScopedAffiliation` / `eduPersonPrimaryAffiliation`, department (`ou`), and any Grouper/AD group for GC faculty or GC majors via `isMemberOf`. Every role-gating rule keys off this.
5. Does the OIDC plugin support **PKCE**? If not, a confidential client with `client_secret` — acceptable?
6. Duo/MFA — enforced at the IdP, nothing on our side?
7. Is single-logout expected, or is clearing our session sufficient?
8. Is there a **test/staging IdP** to develop against?

### C. MCP / API

1. The IdP advertises a `registration_endpoint`. Is **dynamic client registration open or admin-gated**? MCP clients (Claude Desktop/Code, Cursor) expect DCR.
2. If DCR is gated, we will run a local OAuth broker (Keycloak) that federates to Clemson once and issues tokens for roughly 4–6 MCP resource paths under this host. Any objection to downstream tokens being issued by our broker rather than the IdP?
3. Does CCIT already run an OAuth broker we should use instead?
4. Are **refresh tokens / `offline_access`** permitted for long-lived agent sessions?
5. Unattended scripts and on-host agent containers will keep app-issued bearer tokens on loopback, behind the network boundary. Is token + network restriction sufficient? We would like this on record.

### D. Process

1. Is an application security review required, and what triggers it?
2. Who is the ongoing contact for IdP certificate/metadata rotation?
3. Any data-handling paperwork once students are identifiable users?

---

## 3. Reference details

### Requested claims

`sub`, `eppn`, `email`, `name`, `given_name`, `family_name`, `eduPersonAffiliation`, `eduPersonScopedAffiliation`, `ou`, `isMemberOf`

### Intended role policy per service (our side, keyed on affiliation)

| Path | Data | Policy |
|---|---|---|
| `/mcp/clemson_catalog`, `/mcp/clemson_schedule` | Public Banner data | Any authenticated Clemson affiliation |
| `/mcp/gc_wiki` | Curriculum wiki | Read: faculty / staff / student. Write: GC faculty |
| `/mcp/gc_careers` | Alumni career destinations | GC faculty and staff only |
| Curriculum Tool, cob_advisor | Curriculum data, syllabi, interviews | Faculty/staff full; students read-only |

### Contacts

App owner / support contact: ______________________________
