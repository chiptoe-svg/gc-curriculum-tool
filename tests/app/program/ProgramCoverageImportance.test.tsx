import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgramCoverageClient } from '@/app/program/ProgramCoverageClient';

/**
 * Importance filter (membership addendum, plan Review Focus 4): a competency
 * weighted 0.25–0.49 has no coverage cells (scoring uses membership). Lowering
 * the filter must show its column with empty cells, not crash or hide it;
 * raising it hides non-pinned members below the floor; pins always show.
 */
const sub = (id: string, weight: number | null, pinned: boolean, provisional = false) => ({ id, name: id.toUpperCase(), careerTargetId: 't1', careerTargetName: 'Target One', displayOrder: 0, weight, pinned, provisional });
const data = {
  courses: [{
    courseCode: 'GC 1010', courseTitle: 'Intro', level: 1, snapshotId: 'snap-1',
    snapshotCaption: null, snapshotCreatedAt: new Date('2026-01-01'), instructorName: null, pairedCodes: [],
  }],
  targets: [{ id: 't1', name: 'Target One', displayOrder: 1 }],
  subCompetencies: [sub('pin-a', null, true), sub('imp-b', 0.6, false, true)],
  cells: [],
  belowCutoff: { subCompetencies: [sub('low-c', 0.3, false)], cells: [] },
};

describe('ProgramCoverageClient — importance filter', () => {
  it('starts at Important; lowering shows the 0.25–0.49 column; raising keeps only pins and very important', () => {
    render(<ProgramCoverageClient slug="s" initialData={data} initialStaleSnapshotCount={0} initialFlags={[]} isAdmin={false} />);
    expect(screen.getByText('PIN-A')).toBeTruthy();
    expect(screen.getByText('IMP-B')).toBeTruthy();
    expect(screen.queryByText('LOW-C')).toBeNull();
    expect(screen.getByText('Important · provisional')).toBeTruthy();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '0.25' } });
    expect(screen.getByText('LOW-C')).toBeTruthy();
    expect(screen.getAllByText('Somewhat important')).toHaveLength(2); // the option and the LOW-C column's band label
    fireEvent.change(select, { target: { value: '0.75' } });
    expect(screen.getByText('PIN-A')).toBeTruthy();
    expect(screen.queryByText('IMP-B')).toBeNull();
    expect(screen.queryByText('LOW-C')).toBeNull();
  });
});
