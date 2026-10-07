import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AccessPanel, type AccessCourse, type AccessGrant } from '../AccessPanel';

const courses: AccessCourse[] = [
  { code: 'GC 3730', title: 'Account Management' },
  { code: 'GC 1010', title: 'Intro to GC' },
];

function grantRow(over: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: 'g1', label: 'Danita Swaney', email: 'danita@example.edu', scope: ['GC 3730'], can: ['capture'],
    expiresAt: null, revokedAt: null, createdAt: '2026-10-07T00:00:00Z', lastUsedAt: null, status: 'active',
    ...over,
  };
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AccessPanel', () => {
  it('loads and renders grant rows with name, email, courses, and status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ grants: [grantRow()] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);

    await waitFor(() => expect(screen.getByText('Danita Swaney')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getByText('danita@example.edu')).toBeInTheDocument();
    expect(table.getByText('GC 3730')).toBeInTheDocument();
    expect(table.getByText(/^active$/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/admin/access?slug=s');
  });

  it('revoked rows are hidden by default, and the "Show revoked" toggle reveals them', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ grants: [grantRow({ id: 'a', label: 'Active Person' }), grantRow({ id: 'r', label: 'Revoked Person', status: 'revoked', revokedAt: '2026-10-01T00:00:00Z' })] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(screen.getByText('Active Person')).toBeInTheDocument());
    expect(screen.queryByText('Revoked Person')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/show revoked/i));
    expect(screen.getByText('Revoked Person')).toBeInTheDocument();
  });

  it('creating a grant with "All courses" shows the link once, with a Copy button and a mailto Compose email containing the name, courses, and link', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [] }) }) // initial load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          grant: grantRow({ id: 'new', label: 'Pat Faculty', email: 'pat@example.edu', scope: ['*'] }),
          link: 'https://gcworkflow.clemson.edu:8443/?key=tok123',
        }),
      }) // create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [] }) }); // reload after create
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Pat Faculty' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'pat@example.edu' } });
    fireEvent.click(screen.getByLabelText(/all courses/i));
    fireEvent.click(screen.getByRole('button', { name: /add faculty/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // The create POST carried the wildcard scope and never a `can`/`admin` field.
    const createCall = fetchMock.mock.calls[1]!;
    const createBody = JSON.parse((createCall[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(createBody.courses).toBe('*');
    expect(createBody).not.toHaveProperty('can');

    expect(screen.getByText(/won't be shown again/i)).toBeInTheDocument();
    expect(screen.getByText('https://gcworkflow.clemson.edu:8443/?key=tok123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();

    const composeLink = screen.getByRole('link', { name: /compose email/i }) as HTMLAnchorElement;
    expect(composeLink.href).toMatch(/^mailto:pat%40example\.edu\?/);
    const params = new URLSearchParams(new URL(composeLink.href).search);
    const bodyParam = params.get('body') ?? '';
    expect(bodyParam).toContain('Pat');
    expect(bodyParam).toContain('all courses');
    expect(bodyParam).toContain('https://gcworkflow.clemson.edu:8443/?key=tok123');
  });
});
