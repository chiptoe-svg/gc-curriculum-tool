import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CourseRow } from '@/app/courses/CoursesIndex';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const mk = (over: Record<string, unknown> = {}) => ({
  code: 'GC 3460', title: 'Digital Imaging', status: 'captured', lastCapturedAt: null,
  category: 'gc_core', buildsToCareer: true, catalogUrl: null, ...over,
}) as never;

describe('course list: the What-ifs link', () => {
  it('shows "What-ifs (2)" pointing at the course\'s what-if list', () => {
    render(<CourseRow row={mk()} slug="s" index={0} pairedCodes={[]} whatIfCount={2} />);
    const rowEl = screen.getByTestId('course-row-GC 3460');
    const link = within(rowEl).getByRole('link', { name: 'What-ifs (2)' });
    expect(link).toHaveAttribute('href', '/explore/GC%203460?slug=s');
    expect(within(rowEl).queryByText(/explore changes/i)).toBeNull();
  });

  it('shows plain "What-ifs" when there are none', () => {
    render(<CourseRow row={mk()} slug="s" index={0} pairedCodes={[]} />);
    const rowEl = screen.getByTestId('course-row-GC 3460');
    expect(within(rowEl).getByRole('link', { name: 'What-ifs' })).toHaveAttribute('href', '/explore/GC%203460?slug=s');
  });
});
