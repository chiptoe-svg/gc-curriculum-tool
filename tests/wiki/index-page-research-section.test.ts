// @vitest-environment node
/**
 * PF-1 (controller ruling, 2026-10-14 wiki research/ plan): the "AI and GC
 * careers" research section on /wiki must render even when data.courses is
 * empty — it lives OUTSIDE the `isEmpty ? (...) : (...)` branch in
 * app/wiki/page.tsx, which is gated on data.courses.length === 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/wiki/index-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wiki/index-data')>('@/lib/wiki/index-data');
  return {
    ...actual,
    loadWikiIndex: vi.fn(async () => ({
      courses: [],
      targets: [],
      competencies: [],
      concepts: [],
      research: [{ slug: 'ai-careers-brief', title: 'AI and GC careers brief', description: 'Start here.' }],
      recent: [],
    })),
  };
});
vi.mock('@/lib/wiki/course-views', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wiki/course-views')>('@/lib/wiki/course-views');
  return { ...actual, loadTargetMap: vi.fn(async () => null), loadRetiredCompetencyIds: vi.fn(async () => new Set<string>()) };
});
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/components/AskTab', () => ({ AskTab: () => null }));
// Public /wiki now redirects to the Clemson copy; render as its snapshot crawler does.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-gc-wiki-snapshot': '1' }) }));

import WikiIndexPage from '@/app/wiki/page';

describe('/wiki — research section renders when there are no course pages', () => {
  it('shows the "AI and GC careers" heading and link inside the empty-courses state', async () => {
    const html = renderToStaticMarkup(await WikiIndexPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('No course pages yet');
    expect(html).toContain('AI and GC careers');
    expect(html).toContain('/wiki/research/ai-careers-brief');
    expect(html).toContain('AI and GC careers brief');
  });
});
