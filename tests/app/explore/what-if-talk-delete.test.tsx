import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Grant } from '@/lib/auth/authorize';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));
vi.mock('@/app/explore/[code]/what-ifs/[id]/talk/WhatIfChatPanel', () => ({ WhatIfChatPanel: () => <div>chat panel</div> }));
let grant: Grant | null = null;
vi.mock('@/lib/auth/viewer', () => ({ getRequestGrant: async () => grant, personalName: () => null }));

const ID = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/db/what-if-queries', () => ({
  getWhatIf: async () => ({
    id: ID, courseCode: 'GC 3460', ownerGrantId: 'g-owner', ownerKind: 'personal', title: null, pageCreatedAt: null,
  }),
  listWhatIfAttachments: async () => [],
}));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: async () => ({ code: 'GC 3460', title: 'Digital Imaging' }) }));

import WhatIfTalkPage from '@/app/explore/[code]/what-ifs/[id]/talk/page';

const owner = { id: 'g-owner', label: 'Pat', scope: ['GC 3460'], can: ['capture'] } as Grant;
const open = async () => render(await WhatIfTalkPage({
  params: Promise.resolve({ code: 'GC%203460', id: ID }), searchParams: Promise.resolve({ slug: 'faculty-slug-1234' }),
}));

beforeEach(() => { vi.stubEnv('PROTOTYPE_SLUG', 'faculty-slug-1234'); grant = owner; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); push.mockReset(); });

describe('the conversation page: deleting an unfinished what-if', () => {
  it('asks in the page, deletes only after the yes, never uses window.confirm, then goes to the list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await open();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.remove }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(WHAT_IF_COPY.removeConfirm)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.removeYes }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toContain(`/api/explore/GC%203460/what-ifs/${ID}`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/explore/GC%203460?slug=faculty-slug-1234'));
  });

  it('keeping it sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await open();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.remove }));
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.removeNo }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
