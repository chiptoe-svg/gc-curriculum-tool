# Graduate Outcome Data Collection — Spec

> **Status:** Ready to begin. This is the prerequisite data workstream for the Graduate Outcome Validation module. Start here before any validation code is written.

**Goal:** Build a structured, extensible dataset of Clemson GC graduate employment records — both point-in-time (first job) and longitudinal (career history) — suitable for automated curriculum alignment analysis.

**Source:** LinkedIn, supplemented by ACCGC dataset (268 Clemson records already collected, 2018–2026).

---

## What We Already Have

The ACCGC dataset provides 268 Clemson records with:
- Job title
- Company
- SOC code + title
- NAICS code + industry

**Gaps in existing data:**
- Only goes back to 2018 (some data only to 2022 for Clemson-specific collection)
- Point-in-time only — no career history (where people started vs. where they are now)
- No graduation year per record
- No sequence (is this a first job, third job?)

LinkedIn fills all of these gaps.

---

## Data to Collect per Graduate

### Tier 1 — Required
| Field | Source | Notes |
|---|---|---|
| Graduation year | Program records / LinkedIn | Year of GC degree |
| GC concentration | Program records | Management, Design & Tech, Animation, General |
| Position sequence | LinkedIn | 1 = first post-graduation job |
| Job title | LinkedIn | Exact title as listed |
| Company | LinkedIn | Exact name as listed |
| Start month/year | LinkedIn | Month optional, year required |
| End month/year | LinkedIn | Blank = current position |

### Tier 2 — Derive from Tier 1 (coding step)
| Field | Method | Notes |
|---|---|---|
| SOC code | LLM-assisted coding | Job title + company → SOC code |
| SOC title | O*NET lookup | From SOC code |
| NAICS code | Company lookup | Industry of employer |
| NAICS industry | O*NET/BLS lookup | From NAICS code |

### Tier 3 — Optional, high value
| Field | Source |
|---|---|
| Current role (if different from last recorded) | LinkedIn |
| LinkedIn headline | LinkedIn |
| Geographic location | LinkedIn |
| Graduate school / additional degrees | LinkedIn |

---

## Collection Workflow

### Step 1: Build your graduate list
Pull a roster of all GC graduates from program records — name, graduation year, concentration. Go back as far as records allow (target: all graduates since program inception, minimum 2010).

### Step 2: LinkedIn lookup
For each graduate, find their LinkedIn profile. Record all positions held after graduation date in chronological order. Collect Tier 1 fields for every position.

**Practical tips:**
- Search by name + "Clemson" or "graphic communications"
- Alumni list in LinkedIn (Clemson University alumni filter) can speed this up
- Flag profiles you can't find — don't guess
- Some graduates will have private profiles or no LinkedIn presence — expected attrition

**Expected coverage:** Based on field norms, 60–75% of graduates should have findable, reasonably complete LinkedIn profiles.

### Step 3: Enter into collection template
Use the Google Sheet template (see below). One row per position, not per graduate.

### Step 4: SOC coding
After collection, run the job title + company through LLM-assisted coding to assign SOC codes. This can be done in batch. The ACCGC dataset's coding methodology (title → SOC) can serve as the training reference for consistency.

### Step 5: NAICS coding
Look up each company's primary NAICS code. For known employers (ProAmpac, Sandy Alexander, Quad, etc.) reuse the codes from the existing dataset for consistency.

---

## Collection Template (Google Sheet Structure)

**Sheet: Graduates**
| Column | Field |
|---|---|
| A | Graduate ID (anonymized — e.g. CU-2019-001) |
| B | Graduation year |
| C | Concentration |
| D | LinkedIn found? (Y/N) |
| E | Notes |

**Sheet: Positions**
| Column | Field |
|---|---|
| A | Graduate ID |
| B | Sequence (1, 2, 3...) |
| C | Job title (exact) |
| D | Company (exact) |
| E | Start year |
| F | Start month |
| G | End year |
| H | End month |
| I | Current? (Y/N) |
| J | SOC code (fill after coding step) |
| K | SOC title (fill after coding step) |
| L | NAICS code (fill after coding step) |
| M | NAICS industry (fill after coding step) |
| N | Data source (linkedin / survey / accgc-dataset) |
| O | Confidence (high / medium / low) |
| P | Notes |

---

## Priority Order for Collection

**Phase 1 — Extend existing data backwards (point-in-time)**
- Go back to 2010 (or program inception) for current job only
- Fill graduation year gaps in the existing 268-record ACCGC dataset
- Goal: ~10 years of first-job data with graduation year attached

**Phase 2 — Career history for recent cohorts**
- Full career history for 2018–2026 graduates (you have current job; now add the path)
- These graduates are 0–8 years out — career trajectories are forming but visible
- Priority: graduates with 2+ positions on LinkedIn

**Phase 3 — Career history for older cohorts**
- Full career history for 2010–2017 graduates
- These graduates are 9–16 years out — trajectories are mature and most informative
- Highest value for trajectory analysis but most labor-intensive

---

## SOC Coding at Scale

Once Tier 1 data is collected, SOC coding can be semi-automated:

**LLM prompt approach:**
```
Given this job record, assign the most appropriate SOC code from the 
proposed CIP 10.03 crosswalk (21 codes listed below). If none of the 
21 codes fit well, assign the best available SOC code from the full 
BLS SOC taxonomy.

Job title: [title]
Company: [company]
Industry context: [NAICS industry if known]

Return: SOC code, SOC title, confidence (high/medium/low), brief rationale.
```

Run in batch. Flag low-confidence codes for manual review. The existing 268 records serve as calibration — compare LLM coding against the known SOC assignments for consistency.

---

## Privacy Considerations

- Store graduate records with anonymized IDs, not names, in the tool
- The Google Sheet (with names) stays separate from the tool's database
- The mapping between name and ID lives only in the Google Sheet
- Any published analysis (alignment scores, program reports) uses aggregates only — no individual records externally

---

## Import Format for the Tool

Once collected and coded, records export from the Google Sheet as CSV and import into the validation module. Target schema matches the Graduate Record Schema in the validation project spec.

**Minimum viable import:** Graduate ID, graduation year, sequence, SOC code, NAICS code. Job title and company are reference data, not required for the alignment computation.

---

## Estimated Effort

| Phase | Graduates | Time estimate |
|---|---|---|
| Phase 1 (extend backwards, current job only) | ~100–150 additional graduates | 8–12 hours |
| Phase 2 (full history, 2018–2026) | ~150 graduates × avg 2.5 positions | 15–20 hours |
| Phase 3 (full history, 2010–2017) | ~150 graduates × avg 3+ positions | 20–30 hours |
| SOC/NAICS coding (all phases) | LLM-assisted, batch | 3–5 hours |

Phases 1 and 2 together give you enough for both validation functions. Phase 3 gives the richest trajectory data.
