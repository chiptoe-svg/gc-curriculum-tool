import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/app/courses/[code]/PrereqEdgesClient', () => ({ PrereqEdgesClient: () => null }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: async () => ({ code: 'GC 3460', title: 'Digital Imaging', prerequisites: null }),
  courseExists: async () => true,
}));
vi.mock('@/lib/db/prerequisite-edge-queries', () => ({ listEdgesForFocal: async () => [] }));
vi.mock('@/lib/db/career-targets-queries', () => ({ listTargets: async () => [] }));
vi.mock('@/lib/program/prereq-gaps', () => ({ computePrereqGaps: async () => ({ gaps: [] }) }));
let counts = new Map<string, number>();
vi.mock('@/lib/db/what-if-queries', () => ({ countWhatIfsByCourse: async () => counts }));

import CourseDetailPage from '@/app/courses/[code]/page';

beforeEach(() => { vi.stubEnv('PROTOTYPE_SLUG', 'faculty-slug-1234'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const open = async () => render(await CourseDetailPage({
  params: Promise.resolve({ code: 'GC%203460' }), searchParams: Promise.resolve({ slug: 'faculty-slug-1234' }),
}));

describe('course page: the What-ifs link', () => {
  it('shows the count and points at the what-if list', async () => {
    counts = new Map([['GC 3460', 2]]);
    await open();
    expect(screen.getByRole('link', { name: /What-ifs \(2\)/ })).toHaveAttribute('href', '/explore/GC%203460?slug=faculty-slug-1234');
    expect(screen.queryByText(/Explore →/)).toBeNull();
  });

  it('shows plain "What-ifs" when there are none', async () => {
    counts = new Map();
    await open();
    expect(screen.getByRole('link', { name: /^What-ifs →/ })).toBeInTheDocument();
  });
});
