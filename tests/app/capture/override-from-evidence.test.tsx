/**
 * A raise saved through the card's Change flow already carries evidence
 * ("What shows students reach this?"). That text becomes the approval-time
 * override reason, so the reviewer is not asked "why?" a second time.
 * (Owner-approved 2026-10-06.)
 */
import React from 'react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { STMT, validProfile } from './fixtures/override-profile';

vi.mock('@/app/capture/[code]/VerificationSummary', () => ({ VerificationSummary: () => null }));
vi.mock('@/app/capture/[code]/CourseOverview', () => ({ CourseOverview: () => null }));
vi.mock('@/app/capture/[code]/ClassStructureSection', () => ({ ClassStructureSection: () => null }));
vi.mock('@/app/capture/[code]/MajorProjectsSection', () => ({ MajorProjectsSection: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/app/capture/[code]/LegacyBanner', () => ({ LegacyBanner: () => null }));
vi.mock('@/components/FlagDialog', () => ({ FlagDialog: () => null }));

import { ProfileReviewPanel } from '@/app/capture/[code]/ProfileReviewPanel';

function renderPanel(onSave = vi.fn(async () => {})) {
  render(
    <ProfileReviewPanel profile={validProfile()} reviewerStatus="ai_drafted" initialReviewerNote={null} telemetry={null}
      onSave={onSave} onResumeChat={() => {}} courseCode="GC 2400" courseTitle="Color" slug="s" onSnapshotCreated={() => {}} />,
  );
  return onSave;
}

function raiseDoingWithEvidence(text: string) {
  fireEvent.click(screen.getByRole('button', { name: /needs adjusting/i }));
  const row = screen.getByTestId('flag-row-d');
  fireEvent.click(within(row).getByRole('button', { name: /change/i }));
  fireEvent.click(within(row).getByRole('radio', { name: /does it independently in familiar situations/ }));
  fireEvent.change(screen.getByLabelText(/what shows students reach this/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
}

describe('a raise saved with evidence through Change', () => {
  it('never shows the "why?" box and is not counted as needing a reason', () => {
    renderPanel();
    raiseDoingWithEvidence('capstone press checks');
    expect(screen.queryByText(/You raised a score/i)).toBeNull();
    expect(screen.queryByText(/raised score.*need a reason/i)).toBeNull();
    // Approval is open: the card was saved (reviewed) and no reason is missing.
    expect((screen.getByRole('button', { name: 'Approve the profile' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('stores the typed evidence as the override reason, persisted like an approval-time reason', async () => {
    const onSave = renderPanel();
    raiseDoingWithEvidence('capstone press checks');
    await act(async () => { fireEvent.click(within(screen.getByTestId('action-bar')).getByRole('button', { name: 'Save draft' })); });
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = (onSave.mock.calls[0] as unknown[])[0] as CaptureProfile;
    expect(saved.reviewer_overrides).toEqual([
      { statement: STMT, changes: [{ dim: 'd', from: 2, to: 3 }], reason: 'capstone press checks' },
    ]);
  });
});
