/**
 * Owner, 2026-10-07: once the capture is approved and the green "Captured" card
 * shows, the bottom bar ("Approve update", "Save draft", counts) is gone —
 * the faculty member is done.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile } from '@/lib/ai/capture/schema';

vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

// jsdom has no scrollIntoView (the approve dialog scrolls itself into view).
Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;

const cite = [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }];
const profile = {
  competencies: [{
    statement: 'Builds a budget', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r', source: 'materials', citations: cite,
  }],
  incoming_expectations: [],
  verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'inferred', citations: [] },
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
  course_emphasis: [], course_code: 'GC 1010', scale_version: captureScaleVersion, generated_at: 'now',
  overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
} as unknown as CaptureProfile;

describe('after capture', () => {
  it('the bottom action bar disappears once the Captured card shows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(
      <ProfileReviewPanel profile={profile} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
        onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 1010" courseTitle="Intro" slug="s"
        onSnapshotCreated={() => {}} />,
    );
    expect(screen.getByTestId('action-bar')).toBeTruthy();
    const approveButtons = screen.getAllByRole('button', { name: 'Approve the profile' });
    fireEvent.click(approveButtons[approveButtons.length - 1]!);
    const confirm = screen.getAllByRole('button', { name: 'Approve the profile' });
    const inDialog = confirm.find(b => !screen.getByTestId('action-bar').contains(b))!;
    fireEvent.click(inDialog);
    await waitFor(() => expect(screen.getByText(/is now part of the program record/i)).toBeTruthy());
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: /approve update/i })).toBeNull();
    vi.unstubAllGlobals();
  });
});
