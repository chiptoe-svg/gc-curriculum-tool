import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Alice Appleton'] }));

import { WhatIfList, type WhatIfListItem } from '@/app/explore/[code]/WhatIfList';

const item = (over: Partial<WhatIfListItem> = {}): WhatIfListItem => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Weekly preflight lab', authorName: 'Pat Faculty',
  summary: 'Adds a weekly lab on file checks.', pageCreatedAt: '2026-11-10T12:00:00.000Z',
  createdAt: '2026-11-09T12:00:00.000Z', mine: false, ...over,
});
afterEach(cleanup);

describe('WhatIfList', () => {
  it('shows title, author, date and summary for a what-if with a page, linked to its page', () => {
    render(<WhatIfList courseCode="GC 3460" slug="s" canStart defaultName="Pat Faculty" whatIfs={[item()]} />);
    const link = screen.getByRole('link', { name: 'Weekly preflight lab' });
    expect(link).toHaveAttribute('href', '/explore/GC%203460/what-ifs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?slug=s');
    expect(screen.getByText(/Pat Faculty/)).toBeInTheDocument();
    expect(screen.getByText(/Nov 10, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Adds a weekly lab on file checks.')).toBeInTheDocument();
  });

  it("shows the caller's own unfinished what-if marked as such, linked to its conversation", () => {
    render(<WhatIfList courseCode="GC 3460" slug="s" canStart defaultName="Pat Faculty"
      whatIfs={[item({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: null, summary: null, pageCreatedAt: null, mine: true })]} />);
    expect(screen.getByText(WHAT_IF_COPY.listUnfinished)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: WHAT_IF_COPY.listContinue }))
      .toHaveAttribute('href', '/explore/GC%203460/what-ifs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/talk?slug=s');
  });

  it('has the start control when the course has an approved version, and not otherwise', () => {
    render(<WhatIfList courseCode="GC 3460" slug="s" canStart defaultName="Pat Faculty" whatIfs={[]} />);
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.startButton })).toBeInTheDocument();
    expect(screen.getByText(WHAT_IF_COPY.listEmpty)).toBeInTheDocument();
    cleanup();
    render(<WhatIfList courseCode="GC 3460" slug="s" canStart={false} defaultName="Pat Faculty" whatIfs={[]} />);
    expect(screen.queryByRole('button', { name: WHAT_IF_COPY.startButton })).toBeNull();
    expect(screen.getByText(WHAT_IF_COPY.listNoApproved)).toBeInTheDocument();
  });
});
