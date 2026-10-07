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
  it('isAdmin=false: no "stale pair" refresh button', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialFlags={[]} isAdmin={false} />);
    expect(screen.queryByRole('button', { name: /stale pair|up to date/i })).toBeNull();
  });

  it('isAdmin=true: the refresh button is present', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialFlags={[]} isAdmin />);
    expect(screen.getByRole('button', { name: /stale pair|up to date/i })).toBeTruthy();
  });
});
