/**
 * Follow-up (2026-10-06): the approve button says "Approve the profile" for a
 * course's first approval and "Approve update" once a snapshot exists. Every
 * reference to it — summary copy, header, count line, tooltips, the approve
 * dialog — uses exactly the label the button shows in that state.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { captureScaleVersion, type CaptureProfile, type CaptureReviewerStatus } from '@/lib/ai/capture/schema';

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

function renderPanel(status: CaptureReviewerStatus, flagged: boolean) {
  return render(
    <ProfileReviewPanel profile={profile(flagged)} reviewerStatus={status} initialReviewerNote={null} telemetry={null}
      onSave={async () => {}} onResumeChat={() => {}} courseCode="GC 3800" courseTitle="Seminar" slug="s"
      onSnapshotCreated={() => {}} />,
  );
}

function allCopy(container: HTMLElement): string {
  const titles = [...container.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join(' | ');
  const placeholders = [...container.querySelectorAll('[placeholder]')].map(e => e.getAttribute('placeholder')).join(' | ');
  return `${container.textContent} | ${titles} | ${placeholders}`;
}

describe.each([
  ['ai_drafted' as const, 'Approve the profile', 'Approve update'],
  ['confirmed' as const, 'Approve update', 'Approve the profile'],
])('reviewer status %s', (status, label, other) => {
  it(`the button says "${label}" and every mention matches it`, () => {
    const { container } = renderPanel(status, true);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    const copy = allCopy(container);
    expect(copy).not.toContain(other);
    // summary copy, header, count line and lock tooltip all name the button
    expect(screen.getByText(new RegExp(`use “${label}” to record`))).toBeInTheDocument();
    expect(screen.getByText(`1 card left to review — confirm or adjust each to unlock “${label}”`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`nothing is recorded until you use “${label}”`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label }).getAttribute('title')).toContain(`“${label}”`);
    expect(screen.getByRole('button', { name: /save draft/i }).getAttribute('title')).toContain(`“${label}”`);
  });

  it(`the approve dialog is titled and confirmed with "${label}"`, () => {
    const { container } = renderPanel(status, false); // nothing to review → unlocked
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: label })).toHaveLength(2);
    expect(allCopy(container)).not.toContain(other);
    expect(container.textContent).not.toMatch(/Approve & capture|Approve this profile/);
  });
});

it('an update says a new snapshot is added and the earlier one kept', () => {
  renderPanel('confirmed', false);
  expect(screen.getByText(/record this version as a new snapshot — earlier snapshots are kept/)).toBeInTheDocument();
});
