import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramCoverageClient } from '@/app/program/ProgramCoverageClient';

/**
 * F1 (owner decision, 2026-10-07): program-coverage refresh (bulk and
 * per-pair) stays admin-only — the server already enforces this
 * (POST /api/program/coverage/refresh* is admin-kind). This pins that the
 * refresh controls are hidden for a non-admin viewer and shown for an
 * admin one. Flag resolution is covered separately in FlagsPanel.test.tsx;
 * this file only covers the refresh button this component owns directly.
 */

const data = {
  courses: [{
    courseCode: 'GC 1010', courseTitle: 'Intro', level: 1, snapshotId: 'snap-1',
    snapshotCaption: null, snapshotCreatedAt: new Date('2026-01-01'), instructorName: null, pairedCodes: [],
  }],
  targets: [{ id: 't1', name: 'Target One', displayOrder: 1 }],
  subCompetencies: [],
  cells: [],
};

describe('ProgramCoverageClient — admin-only refresh (F1)', () => {
  it('isAdmin=false: no "stale snapshot" refresh button', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialStaleSnapshotCount={2} initialFlags={[]} isAdmin={false} />);
    expect(screen.queryByRole('button', { name: /stale snapshot|up to date/i })).toBeNull();
  });

  it('isAdmin=true: the refresh button is present and states the real work (I-2, hostile-review fix wave — snapshots, not pairs)', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialStaleSnapshotCount={2} initialFlags={[]} isAdmin />);
    expect(screen.getByRole('button', { name: /stale snapshot|up to date/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /score 2 stale snapshots/i })).toBeTruthy();
  });

  it('isAdmin=true, nothing stale: the button reads "Up to date" and is disabled', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialStaleSnapshotCount={0} initialFlags={[]} isAdmin />);
    const button = screen.getByRole('button', { name: /up to date/i });
    expect(button).toBeTruthy();
    expect(button).toBeDisabled();
  });
});
