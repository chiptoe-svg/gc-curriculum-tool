import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Alice Appleton'] }));

import { CaptureHero } from '@/app/capture/[code]/CaptureHero';

const props = {
  courseCode: 'GC 3460', courseTitle: 'Digital Imaging', materialsCount: 2, instructor: 'Alice Appleton',
  onInstructorChange: () => {}, mode: null, onModeChange: () => {}, slug: 's', defaultName: 'Pat Faculty',
};
afterEach(cleanup);

describe('CaptureHero: the what-if start control', () => {
  it('shows it, set apart from the three revision choices, when an approved version exists', () => {
    render(<CaptureHero {...props} priorSnapshotInfo={{ instructorName: 'Lee', createdAt: '2026-10-01T00:00:00Z' }} />);
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.startButton })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('does not show it when the course has no approved version', () => {
    render(<CaptureHero {...props} priorSnapshotInfo={null} />);
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.startButton })).toBeNull();
  });

  it('does not show it to an external tester (no faculty access parameter)', () => {
    render(<CaptureHero {...props} slug="" priorSnapshotInfo={{ instructorName: 'Lee', createdAt: '2026-10-01T00:00:00Z' }} />);
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.startButton })).toBeNull();
  });
});
