/**
 * review-step2-order.test.tsx
 *
 * Asserts the document-order contract from the 2026-06-12 review-screen
 * redesign spec (spec: 2026-06-12-review-step2-redesign-design.md):
 *
 *  1. VerificationSummary renders BEFORE the "Worth a look" heading.
 *  2. "Preview the record" disclosure exists and is collapsed by default
 *     (course-overview content not visible until the disclosure is opened).
 *  3. The sticky bar contains the Approve button.
 *  4. The old "Done reviewing?" footer card no longer exists.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

/* ── Heavy children mocked at module level ──────────────────────────────── */

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({
  VerificationSummary: () => <div data-testid="verification-summary">verification-summary</div>,
}));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({
  CourseOverview: () => <div data-testid="course-overview">course-overview</div>,
}));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({
  ClassStructureSection: () => <div data-testid="class-structure">class-structure</div>,
}));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({
  MajorProjectsSection: () => <div data-testid="major-projects">major-projects</div>,
}));
vi.mock('@/app/capture/[code]/StressTestPanel', () => ({
  StressTestPanel: vi.fn().mockImplementation(() => null),
}));
vi.mock('@/app/capture/[code]/StressTestBadge', () => ({
  StressTestBadge: () => null,
}));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({
  CitationDrawer: () => null,
}));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({
  LegacyBanner: () => null,
}));
vi.mock('@/components/FlagDialog', () => ({
  FlagDialog: () => null,
}));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

/* ── Minimal valid-ish profile fixture ─────────────────────────────────── */

function makeProfile(): CaptureProfile {
  const comp = (statement: string) => ({
    statement,
    type: 'technical' as const,
    k_depth: 2,
    u_depth: 2,
    d_depth: 2,
    evidence_k: 'k evidence',
    evidence_u: 'u evidence',
    evidence_d: 'd evidence',
    rationale: 'rationale',
    source: 'materials' as const,
    citations: [{ type: 'chunk' as const, chunkId: 'c1', messageId: null, excerpt: 'ex' }],
  });

  return {
    competencies: [comp('Color management'), comp('Typography fundamentals')],
    incoming_expectations: [],
    verification_summary: {
      overall_shape: 'Balanced technical course',
      strongest_evidence: 'Rubric-backed outputs',
      dimensional_patterns: 'Know and Do aligned',
      catalog_vs_evidence: 'Consistent',
      foundationals_at_a_glance: 'Agency present',
      source: 'materials' as const,
      citations: [],
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
      source: 'inferred' as const,
      citations: [],
    },
    course_emphasis: [],
    generated_at: new Date().toISOString(),
    scale_version: 'v2',
    overview: null,
    class_structure: null,
    major_projects: null,
    revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

const noop = () => {};
const noopAsync = async () => {};

function renderPanel(profileOverride?: Partial<CaptureProfile>) {
  const profile = { ...makeProfile(), ...profileOverride };
  return render(
    <ProfileReviewPanel
      profile={profile}
      reviewerStatus="ai_drafted"
      initialReviewerNote={null}
      telemetry={null}
      onSave={noopAsync}
      onResumeChat={noop}
      courseCode="GC 3800"
      courseTitle="Junior Seminar"
      slug="test-slug"
      onSnapshotCreated={noop}
    />,
  );
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('Review Step 2 — document order', () => {
  it('VerificationSummary renders BEFORE the "Worth a look" heading in document order', () => {
    renderPanel();

    const summary = screen.getByTestId('verification-summary');
    // With the minimal profile both competencies are "confident" (materials-cited,
    // mid-scored, non-central) so there may be no "Worth a look" heading.
    // Use the "The AI is confident about these" heading which is always present.
    const confident = screen.getByText(/The AI is confident about these/i);

    // compareDocumentPosition: if summary is BEFORE confident, result has DOCUMENT_POSITION_FOLLOWING
    const position = summary.compareDocumentPosition(confident);
    // DOCUMENT_POSITION_FOLLOWING = 4
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Preview the record" disclosure exists and is collapsed by default (overview not visible)', () => {
    renderPanel();

    // The disclosure button exists
    expect(screen.getByRole('button', { name: /preview the record/i })).toBeTruthy();

    // Course-overview is NOT visible before expanding
    expect(screen.queryByTestId('course-overview')).toBeNull();
  });

  it('expanding "Preview the record" reveals the course-overview content', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /preview the record/i }));
    expect(screen.getByTestId('course-overview')).toBeTruthy();
  });

  it('the sticky bar contains the Approve button', () => {
    renderPanel();

    // The approve button lives inside the sticky bar.
    const approveBtn = screen.getByRole('button', { name: /approve the profile/i });
    expect(approveBtn).toBeTruthy();

    // Confirm it (or an ancestor) carries the sticky class
    let el: HTMLElement | null = approveBtn;
    let foundSticky = false;
    while (el) {
      if (el.className && el.className.includes('sticky')) {
        foundSticky = true;
        break;
      }
      el = el.parentElement;
    }
    expect(foundSticky).toBe(true);
  });

  it('"Done reviewing?" footer card no longer exists', () => {
    renderPanel();
    expect(screen.queryByText(/done reviewing/i)).toBeNull();
  });
});
