import { describe, it, expect } from 'vitest';
import {
  renderPrerequisiteProfiles,
  PREREQ_PROFILES_HEADING,
  PREREQ_PROFILES_MAX_CHARS,
} from '@/lib/capture/prereq-profiles-block';
import type { BriefPrereq } from '@/lib/capture/course-context-brief';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

// Minimal-but-valid-shaped profile fixture. Fields the renderer must NEVER
// surface (evidence_k / rationale / citations) carry distinctive strings so
// their absence from the rendered output can be asserted directly.
function makeProfile(overrides: Partial<CaptureProfile> = {}): CaptureProfile {
  return {
    course_code: 'GC 1040',
    scale_version: 'v1',
    generated_at: '2026-01-01T00:00:00.000Z',
    overview: null,
    competencies: [
      {
        statement: 'Operate a proof press',
        type: 'technical',
        k_depth: 3,
        u_depth: null,
        d_depth: 2,
        evidence_k: 'SECRET_EVIDENCE_K_EXCERPT',
        evidence_u: null,
        evidence_d: 'SECRET_EVIDENCE_D_EXCERPT',
        rationale: 'SECRET_RATIONALE_TEXT',
        source: 'instructor',
        citations: [{ type: 'instructor', messageId: '12345678', excerpt: 'SECRET_CITATION_EXCERPT' }],
      },
      {
        statement: 'Articulate color theory',
        type: 'foundational',
        k_depth: null,
        u_depth: null,
        d_depth: 0,
        evidence_k: null,
        evidence_u: null,
        evidence_d: null,
        rationale: 'SECRET_RATIONALE_TEXT_2',
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      course_shape: 'x',
      strongest_evidence: ['x'],
      dimensional_patterns: [],
      catalog_vs_evidence: [],
      foundationals_glance: 'x',
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
    },
    revised_objectives_draft: null,
    course_emphasis: null,
    ...overrides,
  } as CaptureProfile;
}

function makePrereq(overrides: Partial<BriefPrereq> = {}): BriefPrereq {
  return {
    code: 'GC 1040',
    title: 'Intro to Print',
    captureLabel: 'GC 1040 capture snapshot 2026-01-01',
    profile: makeProfile(),
    kind: 'prereq',
    source: 'Clemson catalog 2026–27',
    alternatives: [],
    ...overrides,
  };
}

describe('renderPrerequisiteProfiles', () => {
  it('starts with the exact heading', () => {
    const md = renderPrerequisiteProfiles([makePrereq()]);
    expect(md.split('\n')[0]).toBe(`## ${PREREQ_PROFILES_HEADING}`);
    expect(PREREQ_PROFILES_HEADING).toBe(
      "Prerequisite courses' captured profiles — what students arrive with; never evidence for this course's scores.",
    );
  });

  it('renders competencies with K/U/D depth and source, including K– for null and "not recorded" when absent', () => {
    const md = renderPrerequisiteProfiles([makePrereq()]);
    expect(md).toContain('### GC 1040 — Intro to Print (GC 1040 capture snapshot 2026-01-01)');
  });
  it('marks a "before or alongside" prerequisite on its heading', () => {
    const md = renderPrerequisiteProfiles([makePrereq({ kind: 'concurrent_ok' })]);
    expect(md).toContain('### GC 1040 — Intro to Print (GC 1040 capture snapshot 2026-01-01) — taken before or alongside this course (Clemson catalog 2026–27)');
    expect(md).toContain('Competencies:');
    expect(md).toContain('- [technical] Operate a proof press (K3 U– D2; source: instructor)');
    expect(md).toContain('- [foundational] Articulate color theory (K– U– D0; source: not recorded)');
  });

  it('includes incoming expectations under the "what X itself expects" line', () => {
    const prereq = makePrereq({
      profile: makeProfile({
        incoming_expectations: [
          { statement: 'Measure dot gain', expected_depth: { k: 2, u: null, d: 3 }, evidenced_by: ['x'], confidence: 'high' },
        ],
      }),
    });
    const md = renderPrerequisiteProfiles([prereq]);
    expect(md).toContain('What GC 1040 itself expects students to arrive with:');
    expect(md).toContain('- Measure dot gain (expects K2 U– D3)');
  });

  it('never includes rationale, evidence, or citation excerpt text', () => {
    const md = renderPrerequisiteProfiles([makePrereq()]);
    expect(md).not.toContain('SECRET_EVIDENCE_K_EXCERPT');
    expect(md).not.toContain('SECRET_EVIDENCE_D_EXCERPT');
    expect(md).not.toContain('SECRET_RATIONALE_TEXT');
    expect(md).not.toContain('SECRET_RATIONALE_TEXT_2');
    expect(md).not.toContain('SECRET_CITATION_EXCERPT');
  });

  it('skips prerequisites with no captured profile', () => {
    const md = renderPrerequisiteProfiles([makePrereq(), makePrereq({ code: 'GC 1020', title: 'Design Basics', captureLabel: null, profile: null })]);
    expect(md).not.toContain('GC 1020');
  });

  it('gives a one-line note when no prerequisite has a captured profile', () => {
    const md = renderPrerequisiteProfiles([makePrereq({ captureLabel: null, profile: null })]);
    expect(md).toBe(`## ${PREREQ_PROFILES_HEADING}\nNo prerequisite course has a captured profile yet.`);
  });

  it('caps output and names a dropped course, staying within maxChars', () => {
    const prereqs = [
      makePrereq({ code: 'GC 1040', title: 'Intro to Print' }),
      makePrereq({ code: 'GC 1020', title: 'Design Basics', captureLabel: 'GC 1020 capture snapshot 2026-01-02' }),
    ];
    const full = renderPrerequisiteProfiles(prereqs);
    const idx1020 = full.indexOf('### GC 1020');
    expect(idx1020).toBeGreaterThan(-1);
    const capped = renderPrerequisiteProfiles(prereqs, idx1020);
    expect(capped.length).toBeLessThanOrEqual(idx1020);
    expect(capped).not.toContain('### GC 1020');
    expect(capped).toMatch(/courses not shown: GC 1020\.\)_$/);
  });

  it('respects the default max-chars constant', () => {
    expect(PREREQ_PROFILES_MAX_CHARS).toBe(6000);
  });
});
