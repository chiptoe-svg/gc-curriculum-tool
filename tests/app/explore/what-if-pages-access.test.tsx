import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Grant } from '@/lib/auth/authorize';

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  redirect: (u: string) => { throw new Error(`redirect ${u}`); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/app/explore/[code]/what-ifs/[id]/talk/WhatIfChatPanel', () => ({ WhatIfChatPanel: () => <div>chat panel</div> }));
vi.mock('@/app/explore/[code]/what-ifs/[id]/WhatIfActions', () => ({ WhatIfActions: () => <div>actions</div> }));

let grant: Grant | null = null;
vi.mock('@/lib/auth/viewer', () => ({ getRequestGrant: async () => grant, personalName: () => null }));

const ID = '11111111-1111-4111-8111-111111111111';
let row: Record<string, unknown> | null = null;
let base: Record<string, unknown> | null = null;
let latest: Record<string, unknown> | null = null;
vi.mock('@/lib/db/what-if-queries', () => ({
  getWhatIf: async () => row,
  listWhatIfAttachments: async () => [{ id: 'a', fileName: 'lab-outline.pdf', status: 'ok', heldBackReason: null }],
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getSnapshotById: async () => base,
  getLatestSnapshotByCourse: async () => latest,
}));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: async () => ({ code: 'GC 3460', title: 'Digital Imaging' }) }));

import WhatIfPage from '@/app/explore/[code]/what-ifs/[id]/page';
import WhatIfTalkPage from '@/app/explore/[code]/what-ifs/[id]/talk/page';

const SLUG = 'faculty-slug-1234';
const owner: Grant = { id: 'g-owner', label: 'Pat', scope: ['GC 3460'], can: ['capture'] } as Grant;
const other: Grant = { id: 'g-other', label: 'Sam', scope: ['GC 1010'], can: ['capture'] } as Grant;
const admin: Grant = { id: 'g-admin', label: 'Root', scope: ['*'], can: ['admin', 'capture'] } as Grant;

const finished = {
  id: ID, courseCode: 'GC 3460', baseSnapshotId: 'snap-1', ownerGrantId: 'g-owner', ownerKind: 'personal',
  authorName: 'Pat', title: 'Weekly lab', pageCreatedAt: new Date('2026-11-10T12:00:00Z'),
  estimate: { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] },
  profile: { ratings: [], incomingChanges: [] },
  knockOn: { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [] },
  prose: { description: 'D', whatChanges: 'W', neighbors: 'N', questions: [] },
};
const props = (code = 'GC%203460', slug = SLUG) =>
  ({ params: Promise.resolve({ code, id: ID }), searchParams: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.stubEnv('PROTOTYPE_SLUG', SLUG);
  grant = owner; row = { ...finished };
  base = { id: 'snap-1', instructorName: 'Lee', createdAt: new Date('2026-10-01T00:00:00Z'), retiredAt: null };
  latest = base;
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('the what-if page', () => {
  it('is readable by someone who cannot manage it once it has a page, without the actions', async () => {
    grant = other;
    render(await WhatIfPage(props()));
    expect(screen.getByText('Weekly lab')).toBeInTheDocument();
    expect(screen.queryByText('actions')).toBeNull();
  });

  it('shows the actions to the author and to an admin', async () => {
    render(await WhatIfPage(props()));
    expect(screen.getByText('actions')).toBeInTheDocument();
    cleanup();
    grant = admin;
    render(await WhatIfPage(props()));
    expect(screen.getByText('actions')).toBeInTheDocument();
  });

  it('is not found for a non-owner while it is unfinished', async () => {
    grant = other;
    row = { ...finished, pageCreatedAt: null };
    await expect(WhatIfPage(props())).rejects.toThrow('notFound');
  });

  it('sends the author of an unfinished what-if to the conversation', async () => {
    row = { ...finished, pageCreatedAt: null };
    await expect(WhatIfPage(props())).rejects.toThrow(/redirect .*\/talk/);
  });

  it('is not found for another course\'s code, an unknown signed-in state, or a bad slug gets the access notice', async () => {
    await expect(WhatIfPage(props('GC%201010'))).rejects.toThrow('notFound');
    grant = null;
    await expect(WhatIfPage(props())).rejects.toThrow('notFound');
    grant = owner;
    render(await WhatIfPage(props('GC%203460', 'wrong')));
    expect(screen.getByText('Access link required')).toBeInTheDocument();
  });

  it('shows the withdrawn notice when the base snapshot is retired, and the gone notice when it is deleted', async () => {
    base = { ...base!, retiredAt: new Date() };
    render(await WhatIfPage(props()));
    expect(screen.getByText(/was withdrawn/)).toBeInTheDocument();
    cleanup();
    base = null; row = { ...finished, baseSnapshotId: null };
    render(await WhatIfPage(props()));
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });

  it('says a newer version has been approved when the latest approved version is a different one', async () => {
    latest = { id: 'snap-2', instructorName: 'Kim', createdAt: new Date('2026-11-01T00:00:00Z'), retiredAt: null };
    render(await WhatIfPage(props()));
    expect(screen.getByText(/a newer version has been approved since/i)).toBeInTheDocument();
  });
});

describe('the what-if conversation page', () => {
  it('opens for the author and for an admin', async () => {
    render(await WhatIfTalkPage(props()));
    expect(screen.getByText('chat panel')).toBeInTheDocument();
    cleanup();
    grant = admin;
    render(await WhatIfTalkPage(props()));
    expect(screen.getByText('chat panel')).toBeInTheDocument();
  });

  it('is not found for anyone else, even once the what-if has a page', async () => {
    grant = other;
    await expect(WhatIfTalkPage(props())).rejects.toThrow('notFound');
  });
});
