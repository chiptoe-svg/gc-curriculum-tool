# Graduate Outcome Validation — Project Spec

> **Status:** Defined, not yet planned for implementation. Data collection spec is a parallel workstream. Return to this after data collection is underway.

**Goal:** Validate and tune the KUD methodology by comparing AI-generated course outcomes against empirically documented graduate career destinations — both first jobs and career trajectories.

**Why this matters:** Clemson GC graduates have been landing at PwC, JP Morgan, BBDO, PGA Tour, Bank of America, and 400+ other employers for a decade. The curriculum produced those outcomes. This module makes that connection explicit — and uses the evidence to confirm that the KUD methodology is capturing the right things, or to identify where it needs tuning.

**Architecture:** A separate module in the curriculum developer tool, sharing course/KUD/career target infrastructure but with its own data layer (graduate records, O*NET competency profiles) and its own program-director-level UI. Individual faculty use the course builder. Program directors use this.

---

## Dependency: Lock-In Mechanism (current tool)

Before the validation module can run, the current tool needs a baseline designation — a way to mark an accepted KUD run as the historical reference for a course.

**What to add:**
- `isBaseline: boolean` flag on a KUD run (or `baselineKudRunId` on the course record)
- A "Set as historical baseline" action in the Course Builder KUD tab, visible after KUDs are accepted
- UI indicator showing which run is the designated baseline
- The baseline is immutable — faculty can continue generating and accepting new KUDs without affecting it

**Assumption:** Courses have been relatively static for 8–10 years, so the first accepted KUD run generated from current materials is a reasonable proxy for what students experienced during the period covered by the graduate outcome data (2018–2026).

---

## Function 1: First-Job Alignment

**Question:** Do the KUDs our courses produce align with the competency requirements of the careers our graduates actually enter?

**Inputs:**
- Graduate employment records (job title, SOC code, NAICS industry, company, graduation year)
- O*NET competency profiles for each SOC code in the dataset (pulled via public O*NET API)
- Course baseline KUDs from the curriculum developer tool

**Process:**
1. For each SOC code in the graduate dataset, pull O*NET knowledge / skills / work activities
2. Map O*NET competency language to KUD structure (Knowledge areas → Know, Skills → Understand, Work Activities → Do)
3. Compare each course's baseline KUDs against the competency profiles of the SOC codes graduates enter
4. Score alignment per course × career destination pair

**Outputs:**
- Per-course: which career destinations does this course's KUDs align with, and how strongly?
- Per-career destination: which courses in the curriculum contribute to preparing graduates for this role?
- Program-level: does the aggregate KUD profile of the full curriculum cover the competency requirements of the 21 SOC codes that 88.4% of graduates reach?
- Gap report: career destinations with weak curriculum coverage; courses with KUDs that don't map to any documented destination

**O*NET integration:** Public API at api.onetcenter.org — no auth required for basic competency data. Pull once per SOC code, cache locally.

---

## Function 2: Career Trajectory Alignment

**Question:** Does the curriculum enable not just entry-level placement but career progression?

**Inputs:**
- Longitudinal graduate records — multiple positions per graduate in chronological order (LinkedIn-sourced)
- Same O*NET profiles as Function 1
- Same course baseline KUDs

**Process:**
1. For each graduate with 2+ job records, construct a career sequence: first job → current role
2. Identify trajectory patterns: which entry SOC codes lead to which destination SOC codes over 3–5–10 years?
3. Compare trajectory-level competency requirements against curriculum KUDs — does the curriculum build foundations for advancement, not just entry?
4. Surface where graduates who advance significantly share common starting points (suggesting the curriculum enables trajectory, not just placement)

**Outputs:**
- Trajectory pattern map: which starting roles lead where across the graduate population
- Curriculum-to-trajectory alignment: does the curriculum's KUD profile explain career advancement patterns?
- "Hidden enablers": curriculum outcomes that appear in advanced roles but aren't in entry-level job requirements — these are the long-game skills the program builds

**Data dependency:** Requires longitudinal records. Not available yet — see data collection spec.

---

## Data Architecture

### Graduate Record Schema
```
{
  id: string,
  programCode: string,           // e.g. "CU-GC"
  graduationYear: number,
  positions: [
    {
      sequence: number,          // 1 = first job, 2 = second, etc.
      jobTitle: string,
      company: string,
      startYear: number,
      startMonth: number | null,
      endYear: number | null,    // null = current
      endMonth: number | null,
      socCode: string,
      socTitle: string,
      naicsCode: string,
      naicsIndustry: string,
      dataSource: 'linkedin' | 'survey' | 'accgc-dataset',
    }
  ]
}
```

### O*NET Cache Schema
```
{
  socCode: string,
  socTitle: string,
  blsTrend: string,
  knowledge: string[],
  skills: string[],
  workActivities: string[],
  detailedWorkActivities: string[],
  pulledAt: string,              // ISO date — refresh annually
}
```

---

## Reference Data: Proposed CIP 10.03 SOC Crosswalk (21 codes)

These are the validated career targets grounded in 603 graduate records across 9 programs (2018–2026). They replace the current 6-code crosswalk that captures only 3.4–4.3% of graduates.

**Management & Business (12 codes)**
11-1011 Chief Executives · 11-1021 General and Operations Managers · 11-2021 Marketing Managers · 11-2022 Sales Managers · 11-3051 Industrial Production Managers · 13-1051 Cost Estimators · 13-1082 Project Management Specialists · 13-1161 Market Research Analysts and Marketing Specialists · 41-3091 Sales Representatives of Services · 41-4011 Sales Representatives, Wholesale and Manufacturing · 43-4051 Customer Service Representatives · 51-9061 Quality Control Specialists

**Design, Media & Technology (6 codes)**
15-1255 Web and Digital Interface Designers · 15-1299 Computer Occupations, All Other · 27-1024 Graphic Designers · 27-3031 Public Relations Specialists · 27-4021 Photographers · 27-4032 Video Editors

**Retained from current crosswalk (3 codes)**
51-5111 Prepress Technicians and Workers · 51-5112 Printing Press Operators · 27-1014 Special Effects Artists and Animators

---

## Open Questions

1. **Causation vs. correlation:** The alignment analysis shows whether KUDs *match* career destinations — not whether the curriculum *caused* them. The report should frame this carefully. Strong alignment validates the methodology; it doesn't prove instructional causation.

2. **Multi-program expansion:** The ACCGC dataset has 603 records across 9 programs. Should the validation module support multi-program comparison, or start Clemson-only?

3. **O*NET currency:** O*NET profiles update periodically. Cache invalidation strategy needed — annual refresh is probably sufficient.

4. **Trajectory minimum threshold:** How many positions constitute a usable career trajectory? Suggest minimum 2 positions with at least 2 years between first and most recent.

5. **Baseline timing:** If a course's KUDs were generated in 2026 from current materials, does that represent what 2018 graduates experienced? The "relatively static" assumption holds for most GC courses but should be flaggable per course.
