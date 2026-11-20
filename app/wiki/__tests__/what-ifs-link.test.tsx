import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/app/wiki/wiki.css', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  redirect: (u: string) => { throw new Error(`redirect ${u}`); },
}));
let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('@/lib/wiki/git-ops', () => ({
  readWikiPage: async () => '---\ntitle: Digital Imaging\ndescription: A course.\n---\n\n# Digital Imaging\n\nBody text.\n',
}));
vi.mock('@/lib/wiki/index-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/wiki/index-data')>()),
  loadWikiIndex: async () => ({
    courses: [{ slug: 'gc-3460', code: 'GC 3460', title: 'Digital Imaging', level: 3000, lastCaptured: null, materialsSupported: false }],
    targets: [], competencies: [], concepts: [], research: [],
  }),
}));
vi.mock('@/lib/wiki/course-views', () => ({
  loadCourseViews: async () => null,
  loadTargetMap: async () => null,
  loadRetiredCompetencyIds: async () => new Set<string>(),
}));
vi.mock('@/lib/wiki/objective-guide-section', () => ({ loadObjectiveGuideSection: async () => null }));
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/lib/db/what-if-queries', () => ({
  countWhatIfsByCourse: async () => new Map([['GC 3460', 2]]),
}));

import WikiPage from '@/app/wiki/[type]/[slug]/page';

const SLUG = 'faculty-slug-1234';
beforeEach(() => { vi.stubEnv('PROTOTYPE_SLUG', SLUG); requestHeaders = new Headers(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const open = async (type: string, slug: string, q: string) =>
  render(await WikiPage({ params: Promise.resolve({ type, slug }), searchParams: Promise.resolve(q ? { slug: q } : {}) }));

describe('wiki course page: the What-ifs link', () => {
  it('shows "What-ifs (2)" beside Ask with a valid faculty access parameter', async () => {
    await open('courses', 'gc-3460', SLUG);
    const link = screen.getByRole('link', { name: 'What-ifs (2)' });
    expect(link).toHaveAttribute('href', `/explore/GC%203460?slug=${SLUG}`);
    expect(screen.getByRole('link', { name: 'Ask' })).toBeInTheDocument();
  });

  it('does not show it at all without the faculty access parameter', async () => {
    // Without a slug the request would go to the public copy; the snapshot crawler header opts out of that.
    // Here the public-copy redirect is the same "not faculty" test, so the page must refuse before rendering any link.
    await expect(open('courses', 'gc-3460', '')).rejects.toThrow(/redirect/);
  });

  it('does not show it with a wrong access parameter', async () => {
    await expect(open('courses', 'gc-3460', 'not-the-slug')).rejects.toThrow(/redirect/);
  });

  it('does not show it on pages that are not course pages', async () => {
    await open('concepts', 'color', SLUG);
    expect(screen.queryByRole('link', { name: /What-ifs/ })).toBeNull();
  });
});

describe('wiki course page seen by the public-copy crawler', () => {
  it('has no What-ifs link (no faculty parameter)', async () => {
    requestHeaders = new Headers({ 'x-gc-wiki-snapshot': '1' });
    render(await WikiPage({ params: Promise.resolve({ type: 'courses', slug: 'gc-3460' }), searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('link', { name: /What-ifs/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ask' })).toBeNull();
  });
});
