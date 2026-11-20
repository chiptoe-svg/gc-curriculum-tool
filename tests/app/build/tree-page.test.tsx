// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Tree } from '@/lib/skill-tree/types';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }));
vi.mock('@/app/build/build.css', () => ({}));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'good' }));

const node = (id: string, name: string, parentId: string | null) => ({
  id, name, description: null, parentId, competencyId: parentId ? null : id, foundational: false, weight: 1,
  weightSource: 'default' as const, mergedInto: null, retired: false,
});
const tree: Tree = {
  nodes: [node('color', 'Color management', null), node('icc', 'ICC profile building', 'color'), node('print', 'Print production', null)],
  leaves: [{ courseCode: 'GC 3400', skillRef: 'a', nodeId: 'icc', statement: 'Build a profile', share: null, source: 'faculty', status: 'confirmed' }],
  depths: [],
};
vi.mock('@/lib/db/skill-tree-queries', () => ({
  loadTree: async () => tree,
  loadCareerRequirements: async () => ({
    targets: [{ id: 't1', name: 'Color specialist' }],
    rows: [
      { careerTargetId: 't1', competencyId: 'color', weight: 0.5, weightSource: 'onet' },
      { careerTargetId: 't1', competencyId: 'color', weight: 1, weightSource: 'employer' },
    ],
  }),
}));
vi.mock('@/lib/builder/library', () => ({
  loadLibrary: async () => ({
    courses: [{ code: 'GC 3400', versions: [{ instructorName: 'Dr Who', skills: [{ skillRef: 'a', statement: 'Build a profile', k: 3, u: 3, d: 3 }] }] }],
  }),
}));

afterEach(cleanup);

describe('department tree page', () => {
  it('tree page lists masters with program readings', async () => {
    const { default: Page } = await import('@/app/build/tree/page');
    render(await Page({ searchParams: Promise.resolve({ slug: 'good' }) }));
    expect(screen.getByText('Color management')).toBeTruthy();
    expect(screen.getByText('Print production')).toBeTruthy();
    expect(screen.getByText('K3 U3 D3')).toBeTruthy();   // color master, program reading
    expect(screen.getByText('Color specialist')).toBeTruthy();
  });
  it('explains in plain words that the strongest course counts per dimension at each skill', async () => {
    const { default: Page } = await import('@/app/build/tree/page');
    render(await Page({ searchParams: Promise.resolve({ slug: 'good' }) }));
    expect(screen.getByText(/the strongest course counts, separately for Know, Understand and Do/)).toBeTruthy();
    expect(screen.queryByText(/two\s+instructors/)).toBeNull();
  });
  it('asks for the access link without a valid slug', async () => {
    const { default: Page } = await import('@/app/build/tree/page');
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Access link required')).toBeTruthy();
  });
});
