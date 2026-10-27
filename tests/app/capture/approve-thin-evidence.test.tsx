/**
 * Thin-evidence warning at approval (owner, 2026-10-27: warn and let them
 * continue). The approve dialog shows the warning and its Approve button needs
 * a deliberate "approve anyway" tick first.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile, type CaptureReviewerStatus } from '@/lib/ai/capture/schema';
import type { EvidenceCheck } from '@/lib/capture/materials-health';

vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

const cite = [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }];
function profile(flagged: boolean): CaptureProfile {
  return {
    competencies: [{
      statement: 'Builds a budget', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
      evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
      source: flagged ? 'inferred' : 'materials', citations: flagged ? [] : cite,
    }],
    incoming_expectations: [],
    verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'inferred', citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], course_code: 'GC 3800', scale_version: captureScaleVersion, generated_at: 'now',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

function renderPanel(status: CaptureReviewerStatus, flagged: boolean, evidence: EvidenceCheck | null = null) {
  return render(
    <ProfileReviewPanel profile={profile(flagged)} reviewerStatus={status} initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3800" courseTitle="Seminar" slug="s"
      onSnapshotCreated={() => {}} evidence={evidence} />,
  );
}


const THIN: EvidenceCheck = { warn: true, unreadFiles: ['Photo Book Assignment.docx'], onlySyllabus: true, noCanvas: true };
// The dialog's Approve, not the sticky action bar's.
const dialogApprove = () => screen.getAllByRole('button', { name: 'Approve the profile' }).find(b => !b.closest('[data-testid="action-bar"]'))!;

describe('approve dialog with thin evidence', () => {
  it('shows the warning and needs "approve anyway" before approving', () => {
    renderPanel('ai_drafted', false, THIN);
    fireEvent.click(screen.getByRole('button', { name: 'Approve the profile' }));

    expect(screen.getByText(/very little to work from/i)).toBeInTheDocument();
    expect(screen.getByText(/Photo Book Assignment\.docx/)).toBeInTheDocument();
    expect(dialogApprove()).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /approve anyway/i }));
    expect(dialogApprove()).toBeEnabled();
  });

  it('without a warning the dialog approves as before', () => {
    renderPanel('ai_drafted', false, null);
    fireEvent.click(screen.getByRole('button', { name: 'Approve the profile' }));

    expect(screen.queryByText(/very little to work from/i)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /approve anyway/i })).toBeNull();
    expect(dialogApprove()).toBeEnabled();
  });
});
