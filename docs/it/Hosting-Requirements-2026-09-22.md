# Hosting Requirements — GC Department Services on an IT-hosted Server

Clemson Graphic Communications · prepared for CCIT · 22 September 2026

## Short answer

Three TypeScript/Node.js services plus one PostgreSQL database, all reached today as paths under `https://gcworkflow.clemson.edu:8443` on a department Mac. Nothing in the applications is Mac-specific. All AI inference already runs on campus infrastructure (RCD LLM gateway, DGX Spark), so the server needs **no GPU**. One small Linux VM — 4 vCPU, 8 GB RAM, 100 GB disk — is sufficient for everything in this document.

---

## 1. Components ("modules" at the deployable level)

| # | Component | Repository | What it is | Path today | Data |
|---|---|---|---|---|---|
| 1 | **GC Curriculum Tool** | `gc-curriculum-tool` | Next.js web app: curriculum mapping and analysis, faculty course capture, partner survey, curriculum wiki chat, and an MCP endpoint (`/api/mcp`) | `/` (catch-all) | Curriculum structure, syllabi, faculty interview transcripts, partner survey responses. No grades, no student records. |
| 2 | **Clemson schedule MCP** | `clemson-advising-mcp` | MCP server: class-schedule search over Clemson's published Banner data | `/cu_schedule/` | Public |
| 3 | **Clemson catalog MCP** | `clemson-advising-mcp` | MCP server: College of Business program plans, requirement rules, Gen Ed | `/cu_catalog/` | Public |
| 4 | **COB Advisor** | `CUassistant` | Advising chat assistant (LLM agent using components 2 and 3 as tools) for COB advisors | `/advisor/` | Public curriculum data. No personal information by design — advisors do not enter student identifiers, and imported documents (e.g. DegreeWorks audits) are stripped of personal information in the browser before upload. |
| — | PostgreSQL 17 | — | Database for component 1 | — | as component 1 |
| — | Weaviate | — | Vector store for component 1 (embedded course-material chunks) | — | as component 1 |

Components 2–4 are each a single Node process; component 1 is one Node process plus the two backing services. Each calls the others over HTTPS through the proxy, so they can be moved independently and in any order.

---

## 2. Languages and runtimes

| Component | Language | Runtime | Build |
|---|---|---|---|
| 1 Curriculum Tool | TypeScript 5.x | **Node.js 22 LTS**, `pnpm` 11 | `pnpm install && pnpm build` → `next start` (Next.js 15.5) |
| 2–3 Schedule / catalog MCP | TypeScript 5.5 | Node.js ≥ 22, `npm` | No build; run via `tsx` (`npm install` including dev deps) |
| 4 COB Advisor | TypeScript 5.5 | Node.js ≥ 20 (runs on 22), `npm` | No build; run via `tsx` |
| Python | — | — | **Not required at runtime for any component.** Two off-path uses: `yt-dlp` (Python CLI) for the curriculum tool's YouTube-transcript feature; and the advising repo's `core/` package (Python ≥ 3.12 + Playwright), an offline catalog builder run once a year off-box — "no request ever runs it." |

One Node.js 22 LTS install covers everything. No GPU, CUDA, or ML Python stack. Native Node modules: `sharp` and `pg` work from prebuilt binaries on RHEL 8; **`better-sqlite3` (components 2–4) must be compiled on RHEL 8** — `dnf install gcc-toolset-13-gcc-c++ make python3.12`, then `source /opt/rh/gcc-toolset-13/enable` before `npm install` (or `npm rebuild better-sqlite3`). Verified 2026-09-23. Pin `better-sqlite3` to 12.x as the lockfiles do.

Maintenance tooling: Claude Code (2.1.280) and the OpenAI Codex CLI (0.156.1) both install and run on RHEL 8 with Node 22 (verified in the same test), so the app owner can maintain the deployment on the server the same way as today. They need outbound HTTPS to `api.anthropic.com` and `api.openai.com` (or the RCD gateway, if it proxies them) from the app owner's shell — add to §5 egress if used.

---

## 3. Compute

| Item | Requirement | Notes |
|---|---|---|
| OS | **RHEL 8** (CCIT standard) | Verified 2026-09-23 in a Rocky Linux 8.9 container (binary-compatible, glibc 2.28): Node 22 via NodeSource, PostgreSQL 17 via PGDG, Shibboleth SP 3.6 from the project's EL8 repo, Podman 4.9, Python 3.12 — all install and run. One caveat: the `better-sqlite3` prebuilt binary needs glibc 2.29, so on RHEL 8 it must be built from source with `gcc-toolset-13` (AppStream; the system gcc 8.5 lacks C++20). Tested: 64 s build, loads correctly. Note RHEL 8 maintenance support ends 2029-05-31 — see Q13. |
| CPU / RAM | 4 vCPU / 8 GB | 16 GB gives headroom for Weaviate; no GPU |
| Disk | 100 GB | Measured 2026-09-22: everything that moves is ≈ 5 GB (code + build 1 GB, curriculum data 2.6 GB, Weaviate 0.4 GB, Postgres 0.2 GB, advising MCP + advisor 0.9 GB). OS, runtimes and container images add ~15 GB. 100 GB leaves room for uploaded course materials, logs and IT snapshots. (The department Mac's ~825 GB in use is ~90 % local model weights, agent-container images and caches — none of which exist on a server that uses campus GPUs.) |
| Process manager | systemd | One unit per component (4) + timers; replaces macOS launchd |

---

## 4. Backing services

| Service | Version | Used by | Role | Hosting options |
|---|---|---|---|---|
| **PostgreSQL** | 17 | 1 | Primary database (`gc_curriculum`). Plain SQL, no extensions. | IT-managed Postgres, or on-VM |
| **Weaviate** | current | 1 | Vector store; multi-tenant (one tenant per course). ~400 MB. | Container on the VM, loopback only |
| **SQLite** | (bundled) | 2, 3, 4 | File-based state; no server | — |
| **docling-serve** | current | 1 | Document extraction. Primary is the DGX Spark instance; local copy is a fallback | Container on the VM |

---

## 5. Network

### Inbound

| Port | Purpose |
|---|---|
| 443 | HTTPS, terminated by the reverse proxy |
| 22 | Admin SSH |

All components bind `127.0.0.1` behind the proxy. Campus/VPN-only is fine.

### Outbound (egress the hosting network must permit)

| Destination | Port | Used by | Purpose |
|---|---|---|---|
| `llm.rcd.clemson.edu` | 443 | 1, 4 | RCD LLM gateway — all LLM calls |
| `gcspark.clemson.edu` (130.127.162.68) | 8080, 5001 | 1, 4 | DGX Spark — embeddings, vision, ASR; docling extraction |
| `regssb.sis.clemson.edu` | 443 | 2 | Banner self-service — daily schedule refresh (until the data feed in Q10 exists) |
| `catalog.clemson.edu` | 443 | 1, 3 | Course catalog |
| `clemson.instructure.com` | 443 | 1 | Canvas API — faculty course import |
| `github.com` / `api.github.com` | 443 | 1 | Wiki repo sync, feedback issues, weekly off-site DB dump (external) |
| `www.youtube.com` | 443 | 1 | `yt-dlp` transcript fetch |
| `sheets.googleapis.com` | 443 | 1 | Partner-survey sheet export |

Component 4 calls components 2 and 3 over HTTPS (URLs are configuration). System tools needed on PATH: `git`, `yt-dlp`.

---

## 6. Data

| Store | Component | Contents | Size | Classification |
|---|---|---|---|---|
| PostgreSQL | 1 | Courses, competencies, coverage scores, faculty interview transcripts, partner survey responses, feedback | 16 MB | Internal. No grades, no student records. |
| Weaviate | 1 | Embedded chunks of syllabi, assignments, slides | ~400 MB | Internal (course materials) |
| Materials blob dir | 1 | Uploaded PDFs/DOCX/PPTX | ~30 MB | Internal |
| Wiki git repo | 1 | LLM-maintained curriculum narrative (markdown); mirrored to private GitHub | small | Internal |
| SQLite + snapshots | 2, 3 | Converted Banner schedule and catalog data | ~115 MB | Public |
| SQLite | 4 | Sessions, feedback, analytics, skill cache | ~30 MB | Internal, no personal information |

Backups today: nightly `pg_dump` + tar of blob dir and vector store (30 kept), 6-hourly DB snapshot, weekly off-site to GitHub. **IT backup of the VM/DB replaces all of this.** A one-command restore script exists in the curriculum repo.

---

## 7. Configuration and secrets

Environment variables, read from a `.env` file (chmod 600) or a secrets manager — the code reads env either way.

| Component | Count | Groups | Sensitive items |
|---|---|---|---|
| 1 | ~55 | DB, LLM, Spark endpoints, vector store, auth, integrations, cost guard, origins | `DATABASE_URL`, `OPENAI_API_KEY` (RCD gateway key), `WEAVIATE_API_KEY`, `GITHUB_TOKEN`, `FACULTY_BASIC_AUTH` / `CREATE_ONLY_AUTH` (replaced by SSO), `WIKI_MCP_TOKEN`, `CURRICULUM_SEARCH_TOKEN` |
| 2–3 | ~8 | Transport, host/port, per-server auth tokens | `MCP_SCHEDULE_AUTH_TOKEN`, `MCP_CATALOG_AUTH_TOKEN` (consumer bearer tokens, revocable) |
| 4 | ~35 | LLM provider chain, MCP URLs/tokens, Whisper, session, limits | `CLEMSON_LLM_API_KEY`, `ADVISOR_PASSWORD` (replaced by SSO), `ADVISOR_MCP_*_TOKEN`, `ADVISOR_WHISPER_KEY` |

Component 4 is launched today through a Mac-local wrapper (`onecli run`) that routes its outbound HTTPS via a credential-injecting proxy. It is **not a dependency**: it injects no environment variables, the component's own `.env` already carries its keys, and components 1–3 do not use it at all. On the IT host the wrapper is simply dropped; the only migration check is one live LLM call to confirm the `.env` gateway key works without the proxy.

---

## 8. Scheduled jobs

| Job | Component | Cadence | On IT host |
|---|---|---|---|
| Banner schedule refresh | 2 | daily | systemd timer (required) |
| Full backup | 1 | daily 03:30 | Replace with IT backup |
| DB snapshot | 1 | every 6 h | Replace with IT backup |
| Feedback triage | 1 | daily | systemd timer, or drop |
| Health watchdog | 1 | every 5 min | Unnecessary with systemd `Restart=always` |

---

## 9. Deployment model

- Source: three private GitHub repos; `main` is production.
- Deploy: `git pull`, install, (build for component 1), `systemctl restart <unit>`. CI runner if IT prefers.
- Database migrations: Drizzle, `pnpm db:migrate` (component 1), run on deploy.
- App owner needs: shell access to deploy, read access to logs, ability to edit env files. Root not required after initial setup.
- Staging instance desirable, not required.

---

## 10. What is Mac-specific today, and what replaces it

| Today on the Mac | Why it exists | On Linux |
|---|---|---|
| omlx (Apple MLX local LLM / Whisper) | Local inference option; local Whisper for advisor dictation | Not needed. Production already uses RCD (`AI_PROVIDER=openai`); ASR goes to Spark. |
| `dgx-forward` loopback relay | Works around macOS Local Network Privacy blocking background processes | Not needed; Linux talks to Spark directly |
| `onecli run` wrapper (component 4 only) | Local outbound-proxy credential injection; not a dependency | Dropped; `.env` as-is |
| Postgres.app, launchd plists, Caddy | Mac packaging | System Postgres, systemd units, Apache/nginx |
| Local docling-serve fallback | Resilience when Spark is down | Container |

The move is packaging, not porting.

---

## 11. Authentication on the IT host

Shibboleth SP at the reverse proxy. Attributes the apps consume from headers: `eppn`, `mail`, `displayName`, **`eduPersonAffiliation` / `eduPersonScopedAffiliation`** (required for role gating), `isMemberOf` for a GC-faculty or advisor group if available. Replacing the current password checks with trust-the-SP-headers is a contained change in each app (`middleware.ts` + `lib/auth/basic-auth.ts` in component 1; `src/advisor-auth.ts` in component 4). Attribute release and SP registration are covered in the separate SSO Integration Brief.

| Path | Backend | SP-protected |
|---|---|---|
| `/`, `/view/*` | 1 | no — public read-only |
| `/capture`, `/explore`, `/program`, `/admin`, `/settings`, `/wiki`, `/ask`, `/courses` | 1 | **yes** — faculty/staff |
| `/partners/*` | 1 | no — magic link for external partners |
| `/advisor/*` | 4 | **yes** — staff/faculty + advisor group or eppn allow-list |
| `/cu_schedule/*`, `/cu_catalog/*` | 2, 3 | no — per-consumer bearer tokens (MCP clients don't do browser SSO; data is public) |
| `/api/mcp` | 1 | no — app-issued bearer, campus-only |

---

## 12. Questions for IT

1. VM or container platform? If containers, Docker/Podman on a VM, or Kubernetes/OpenShift?
2. Is PostgreSQL offered as a managed service, or do we run it on the VM?
3. Can the VM run a Weaviate container (or is there a hosted vector store)?
4. Outbound egress from the hosting network to the destinations in §5 — RCD gateway, Spark (`:8080`, `:5001`), Banner self-service, GitHub, Canvas?
5. Is Node.js 22 LTS in the standard image? If native-module prebuilts are unavailable, can `python3 make g++` be installed?
6. Deploy access: shell for the app owner? CI/CD from GitHub?
7. Backups: coverage (VM snapshot, DB), retention, restore request process.
8. Logs and monitoring: how does the app owner see application logs and get alerted?
9. Staging instance possible?
10. `clemson-advising-mcp/docs/clemson-it-data-api-request.md` asks for a supported schedule data feed instead of scraping Banner's public pages daily (this has been approved by CheckIT #4528405715, but still working with Rock McCaskill on making it happen).
11. Cost, SLA, patching responsibility (OS vs. Node vs. app), expected turnaround.
12. Proposed order: components 2–3 first (public data, smallest, repo already written for IT security review with `docs/security.md`, `docs/capacity.md`, `docs/operations.md`, `deploy/`), then 4, then 1.
13. RHEL 8 maintenance support ends 2029-05-31. What is CCIT's RHEL 9 timeline for hosted VMs, and would a migration be an in-place upgrade or a new VM? (Nothing in our stack is RHEL-8-specific; RHEL 9 removes the compiler caveat.)
14. Can the VM disk be grown online later (LVM + xfs)? If not, we would ask for 200 GB rather than 100 GB up front.

---

## Appendix A — Third-party packages per component

Runtime dependencies as declared in each `package.json` (dev-only tooling omitted except where needed at runtime). Transitive dependencies are resolved by the lockfiles and can be exported on request (`npm ls --all` / `pnpm licenses list`).

### Component 1 — Curriculum Tool (32 runtime packages)

| Area | Packages |
|---|---|
| Framework / UI | `next` 15.5.18, `react` 19.1, `react-dom` 19.1, `@base-ui/react`, `shadcn`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `react-markdown`, `remark-gfm`, `@react-email/components` |
| Database | `drizzle-orm` 0.45, `pg` 8.21 |
| Vector store | `weaviate-client` 3.13 |
| AI / LLM | `ai` 6 + `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` (the open-source "AI SDK" npm library, maintained by Vercel — a client library only; **no Vercel service is used or contacted**; Vercel hosting was retired 2026-06-04), `openai` 6, `@anthropic-ai/sdk` |
| MCP | `@modelcontextprotocol/sdk` 1.29 |
| Documents / files | `mammoth` (DOCX), `unpdf` (PDF), `sharp` (images, native), `yauzl` / `yazl` (zip), `papaparse` (CSV), `fast-xml-parser`, `youtube-transcript` |
| Validation | `zod` 4 |
| Build-time only | `typescript` 5, `tailwindcss` 4, `drizzle-kit`, `eslint`, `vitest` |

### Components 2–3 — Schedule / catalog MCP (3 runtime + 2 needed at run)

| Area | Packages |
|---|---|
| MCP | `@modelcontextprotocol/sdk` 1.29 |
| Storage | `better-sqlite3` 12 (native) |
| Config | `yaml` 2 |
| Needed at run (declared dev) | `tsx` 4, `typescript` 5.5 |

### Component 4 — COB Advisor (6 runtime + 2 needed at run)

| Area | Packages |
|---|---|
| Agent / LLM | `@earendil-works/pi-agent-core` 0.82, `@earendil-works/pi-ai` 0.82 |
| MCP | `@modelcontextprotocol/sdk` 1.29 |
| Storage | `better-sqlite3` 12 (native) |
| Documents | `pdfjs-dist` 4 (client-side document parsing) |
| Config | `yaml` 2 |
| Needed at run (declared dev) | `tsx` 4, `typescript` 5.5 |

### System packages

| Package | Purpose | Required |
|---|---|---|
| Node.js 22 LTS, `npm`, `pnpm` 11 | Runtime | Yes |
| PostgreSQL 17 client + server (or managed) | Component 1 | Yes |
| `git` | Wiki repo sync, deploys | Yes |
| Apache + `mod_shib` (or nginx + SP) | Proxy + SSO | Yes |
| Docker/Podman | Weaviate, docling-serve | Yes, unless IT hosts Weaviate |
| `python3` + `yt-dlp` | YouTube transcripts | Yes |
| `python3 make g++` | Native-module build fallback | Only if prebuilts unavailable |
