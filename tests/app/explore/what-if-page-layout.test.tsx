import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import type { KnockOn, WhatIfEstimate, WhatIfProfile, WhatIfProse } from '@/lib/what-if/types';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { WhatIfPageLayout, type WhatIfPageView, type WhatIfBase } from '@/app/explore/[code]/what-ifs/[id]/WhatIfPageLayout';

const ID = '11111111-1111-4111-8111-111111111111';

const estimate: WhatIfEstimate = {
  changeItems: [
    { kind: 'added', description: 'A preflight lab each week' },
    { kind: 'changed', description: 'Final project graded on file quality' },
  ],
  movedRatings: [],
  newCompetencies: [],
  incomingChanges: [{ kind: 'new', statement: 'Color management basics', expected: { k: 2, u: null, d: null }, subCompetencyId: null }],
};
const profile: WhatIfProfile = {
  ratings: [
    { statement: 'Attention to detail', type: 'foundational', status: 'approved',
      kud: { k: null, u: null, d: 3 }, before: { k: null, u: null, d: 3 },
      confidence: null, reason: null, subCompetencyId: null, linked: true },
    { statement: 'Prepare print-ready files', type: 'technical', status: 'moved',
      kud: { k: 3, u: 3, d: 2 }, before: { k: 3, u: 3, d: 3 },
      confidence: 'medium', reason: 'Less time on file handoff', subCompetencyId: null, linked: true },
    { statement: 'Soft proofing', type: 'technical', status: 'new',
      kud: { k: 1, u: 1, d: 1 }, before: null,
      confidence: 'low', reason: 'A new lab introduces it', subCompetencyId: null, linked: false },
  ],
  incomingChanges: [],
};
const knockOn: KnockOn = {
  laterCourses: [{ courseCode: 'GC 4400', subCompetencyId: 'x', label: 'Preflight', effect: 'closed' }],
  earlierCourses: [{ statement: 'Color management basics', label: null, status: 'not_met', deliveredBy: [] }],
  careerTargets: [],
  notComputed: ['Soft proofing'],
  careerNotComputed: false,
};
const prose: WhatIfProse = {
  description: 'This course would now run a weekly preflight lab.',
  whatChanges: 'Students spend more time on file checks.',
  neighbors: 'GC 4400 can lean on the new lab.',
  questions: ['Is a weekly lab too much?'],
};
const view = (over: Partial<WhatIfPageView> = {}): WhatIfPageView => ({
  id: ID, courseCode: 'GC 3460', title: 'Weekly preflight lab',
  authorName: 'Pat Faculty', pageCreatedAt: '2026-11-10T12:00:00.000Z',
  estimate, profile, knockOn, prose,
  attachments: [{ fileName: 'lab-outline.pdf', status: 'ok' }],
  ...over,
});
const base: WhatIfBase = { state: 'ok', approvedBy: 'Lee Teacher', approvedAt: '2026-10-01T12:00:00.000Z' };
const renderIt = (v = view(), b: WhatIfBase = base, canManage = true) =>
  render(<WhatIfPageLayout view={v} base={b} canManage={canManage} slug="s" />);

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); push.mockReset(); refresh.mockReset(); });

const row = (statement: string) => {
  const cell = within(screen.getByRole('table')).getByText(statement);
  return cell.closest('tr') as HTMLElement;
};

describe('WhatIfPageLayout', () => {
  it('shows the banner, the predicted label on moved and new ratings only, and the change as before to after', () => {
    renderIt();
    expect(screen.getByText(WHAT_IF_COPY.banner)).toBeInTheDocument();
    expect(within(row('Prepare print-ready files')).getByText('predicted')).toBeInTheDocument();
    expect(within(row('Prepare print-ready files')).getByText(/D3\s*→\s*D2/)).toBeInTheDocument();
    expect(within(row('Soft proofing')).getByText('predicted')).toBeInTheDocument();
    expect(within(row('Attention to detail')).queryByText('predicted')).toBeNull();
  });

  it('says plainly when effects could not be computed, and links each named course to its wiki page', () => {
    renderIt();
    expect(screen.getByText(/no effects on other courses could be computed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GC 4400' })).toHaveAttribute('href', expect.stringContaining('/wiki/courses/gc-4400'));
  });

  it('says career effects could not be computed, not "no effects found", when the marker is set', () => {
    renderIt(view({ knockOn: { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [], careerNotComputed: true } }));
    expect(screen.getByText(/effects on career targets could not be computed/i)).toBeInTheDocument();
    expect(screen.queryByText(WHAT_IF_COPY.neighborsNone)).toBeNull();
  });

  it('puts the banner first, then the five sections in the spec order', () => {
    renderIt();
    const names = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(names).toEqual([
      WHAT_IF_COPY.sectionChanges, WHAT_IF_COPY.sectionCourse, WHAT_IF_COPY.sectionNeighbors,
      WHAT_IF_COPY.sectionQuestions, WHAT_IF_COPY.sectionBasis,
    ]);
    expect(screen.getByText(WHAT_IF_COPY.banner).compareDocumentPosition(screen.getByText(WHAT_IF_COPY.sectionChanges)))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders the prose, the questions and the attachment names', () => {
    renderIt();
    expect(screen.getByText('This course would now run a weekly preflight lab.')).toBeInTheDocument();
    expect(screen.getByText('Is a weekly lab too much?')).toBeInTheDocument();
    expect(screen.getByText('lab-outline.pdf')).toBeInTheDocument();
  });

  it('shows the removal fallback when nothing was removed, and the removal when there is one', () => {
    renderIt();
    expect(screen.getByText(WHAT_IF_COPY.removedFallback)).toBeInTheDocument();
    cleanup();
    renderIt(view({ estimate: { ...estimate, changeItems: [...estimate.changeItems, { kind: 'removed', description: 'The color theory lecture' }] } }));
    expect(screen.queryByText(WHAT_IF_COPY.removedFallback)).toBeNull();
    expect(screen.getByText('The color theory lecture')).toBeInTheDocument();
  });

  it('a withdrawn or deleted base shows a notice and no Update button; a newer approved version is stated', () => {
    renderIt(view(), { state: 'withdrawn', approvedBy: null, approvedAt: null });
    expect(screen.getByText(WHAT_IF_COPY.withdrawnVersion)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.update })).toBeNull();
    cleanup();
    renderIt(view(), { state: 'gone', approvedBy: null, approvedAt: null });
    expect(screen.getByText(WHAT_IF_COPY.goneVersion)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.update })).toBeNull();
    cleanup();
    renderIt(view(), { ...base, state: 'newer' });
    expect(screen.getByText(/a newer version has been approved since/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.update })).toBeInTheDocument();
  });

  it('says so when nothing moved', () => {
    renderIt(view({ profile: { ...profile, ratings: profile.ratings.filter(r => r.status === 'approved') } }));
    expect(screen.getByText(WHAT_IF_COPY.nothingMoved)).toBeInTheDocument();
  });

  it('a reader who cannot manage sees no Update, Rename, Delete or conversation link', () => {
    renderIt(view(), base, false);
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.update })).toBeNull();
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.rename })).toBeNull();
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.remove })).toBeNull();
    expect(screen.queryByRole('link', { name: WHAT_IF_COPY.conversationLink })).toBeNull();
  });

  it('a manager sees the conversation link', () => {
    renderIt();
    expect(screen.getByRole('link', { name: WHAT_IF_COPY.conversationLink }))
      .toHaveAttribute('href', expect.stringContaining(`/what-ifs/${ID}/talk`));
  });

  it("the ratings table is the record's ratings, not parsed from the prose", () => {
    renderIt(view({ prose: { ...prose, description: '| Prepare print-ready files | K9 U9 D9 |' } }));
    const r = row('Prepare print-ready files');
    expect(within(r).getAllByRole('cell').slice(1).map(c => c.textContent)).toEqual(['3', '3', '2']);
  });

  it('delete asks in the page, not with window.confirm, and removes only after the yes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.remove }));
    expect(screen.getByText(WHAT_IF_COPY.removeConfirm)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.removeYes }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toContain(`/api/explore/GC%203460/what-ifs/${ID}`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it('Update posts to the page route and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.update }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toContain(`/what-ifs/${ID}/page`);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Update shows the server's message when it is refused", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'The approved version was withdrawn.', code: 'baseline_withdrawn' }), { status: 409 })));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.update }));
    expect(await screen.findByText('The approved version was withdrawn.')).toBeInTheDocument();
  });
});
