import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CourseRow } from '@/app/courses/CoursesIndex';

// CourseRow renders CourseClassControls which calls useRouter()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const mk = (over: Record<string, unknown> = {}) => ({
  code: 'GC 3460', title: 'Digital Imaging', status: 'captured', lastCapturedAt: null,
  category: 'gc_core', buildsToCareer: true, catalogUrl: null, ...over,
}) as never;

describe('CourseRow verbs', () => {
  it('captured course: Edit Course, View Course, Explore Changes, N versions', () => {
    render(<CourseRow row={mk({ status: 'captured' })} slug="s" index={0} pairedCodes={[]} versionCount={3} />);
    // scope to the row via a testid you add on the row wrapper: data-testid={`course-row-${row.code}`}
    const rowEl = screen.getByTestId('course-row-GC 3460');
    expect(within(rowEl).getByText(/edit course/i)).toBeInTheDocument();
    const view = within(rowEl).getByRole('link', { name: /view course/i });
    expect(view).toHaveAttribute('href', expect.stringContaining('/view/GC%203460'));
    expect(within(rowEl).getByText(/explore changes/i)).toBeInTheDocument();
    expect(within(rowEl).getByText(/3 versions/i)).toBeInTheDocument();
  });
  it('not-started course: Capture Course, no View, no versions', () => {
    render(<CourseRow row={mk({ status: 'not-started' })} slug="s" index={0} pairedCodes={[]} versionCount={0} />);
    const rowEl = screen.getByTestId('course-row-GC 3460');
    expect(within(rowEl).getByText(/capture course/i)).toBeInTheDocument();
    expect(within(rowEl).queryByText(/view course/i)).toBeNull();
    expect(within(rowEl).queryByText(/versions/i)).toBeNull();
  });
});
