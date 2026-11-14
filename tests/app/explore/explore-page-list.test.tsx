import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/slug', () => ({ isValidSlug: () => true }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: async (code: string) => ({ code, title: 'Digital Prepress' }),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: async () => ({ id: 'snap' }) }));
vi.mock('@/lib/db/what-if-queries', () => ({
  listWhatIfsForCourse: async () => [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Weekly preflight lab', authorName: 'Pat Faculty',
    summary: 'Adds a weekly lab.', pageCreatedAt: new Date('2026-11-10T12:00:00Z'),
    createdAt: new Date('2026-11-09T12:00:00Z'), ownerKind: 'personal', ownerGrantId: 'g1',
  }],
}));
vi.mock('@/lib/auth/viewer', () => ({ getRequestGrant: async () => null, personalName: () => 'Pat Faculty' }));
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Pat Faculty'] }));

import ExplorePage from '@/app/explore/[code]/page';

afterEach(cleanup);

describe('/explore/[code]', () => {
  it('renders the what-if list and no chat input', async () => {
    const ui = await ExplorePage({
      params: Promise.resolve({ code: 'GC%203730' }),
      searchParams: Promise.resolve({ slug: 's' }),
    });
    render(ui);
    expect(screen.getByRole('link', { name: 'Weekly preflight lab' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ask about/)).toBeNull();
    expect(screen.queryByText(/Asking about/)).toBeNull();
    expect(screen.getByRole('link', { name: /Guide/ })).toBeInTheDocument();
  });
});
