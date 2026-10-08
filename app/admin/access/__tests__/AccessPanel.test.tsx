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
    expect(bodyParam).toContain('Your courses:\n- All courses in the tool');
    expect(bodyParam).toContain('https://gcworkflow.clemson.edu:8443/?key=tok123');
  });

  it('the Compose email lists each course with its title (code only when the title is unknown)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          grant: grantRow({ id: 'new', label: 'Pat Faculty', email: 'pat@example.edu', scope: ['GC 3730', 'GC 1010', 'GC 9999'] }),
          link: 'https://gcworkflow.clemson.edu:8443/?key=tok456',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Pat Faculty' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'pat@example.edu' } });
    fireEvent.click(screen.getByLabelText(/all courses/i));
    fireEvent.click(screen.getByRole('button', { name: /add faculty/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const composeLink = screen.getByRole('link', { name: /compose email/i }) as HTMLAnchorElement;
    const bodyParam = new URLSearchParams(new URL(composeLink.href).search).get('body') ?? '';
    expect(bodyParam).toContain('for GC 3730, GC 1010, GC 9999.');
    expect(bodyParam).toContain('Your courses:\n- GC 3730: Account Management\n- GC 1010: Intro to GC\n- GC 9999\n');
  });

  it('shows a CLI admin row read-only with a note, and disables Edit / Send a new link (Revoke stays enabled) — fix round 1, L1', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ grants: [grantRow({ id: 'admin1', label: 'Owner CLI Grant', can: ['capture', 'create', 'admin'] })] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(screen.getByText('Owner CLI Grant')).toBeInTheDocument());

    expect(screen.getByText(/managed from the command line/i)).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('button', { name: /^edit$/i })).toBeDisabled();
    expect(table.getByRole('button', { name: /send a new link/i })).toBeDisabled();
    expect(table.getByRole('button', { name: /revoke/i })).not.toBeDisabled();
  });

  it('Add a course: a catalog code shows the catalog title read-only and Add creates it with that title (access-panel addendum)', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/api/admin/access/catalog')) {
        return { ok: true, json: async () => ({ found: true, code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', onCourseList: false, baseCode: null, baseTitle: null }) };
      }
      if (url.includes('/api/admin/access/courses')) {
        return { ok: true, json: async () => ({ code: 'ECON 2120', title: 'Principles of Macroeconomics', category: 'other', categoryLabel: 'Other courses' }) };
      }
      return { ok: true, json: async () => ({ grants: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const codeInput = screen.getByLabelText(/add.*course.*code|course code/i);
    fireEvent.change(codeInput, { target: { value: 'econ 2120' } });
    fireEvent.blur(codeInput);

    await waitFor(() => expect(screen.getByText('Principles of Macroeconomics')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText(/Added ECON 2120 — Principles of Macroeconomics to Other courses/)).toBeInTheDocument());

    const createCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/api/admin/access/courses'))!;
    const createBody = JSON.parse((createCall[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(createBody.code).toBe('econ 2120');
  });

  it('Add a course: a non-catalog code requires a title and shows the "not in catalog" hint', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/api/admin/access/catalog')) {
        return { ok: true, json: async () => ({ found: false, code: 'ENTR 4080', title: null, description: null, onCourseList: false, baseCode: null, baseTitle: null }) };
      }
      if (url.includes('/api/admin/access/courses')) {
        return { ok: true, json: async () => ({ code: 'ENTR 4080', title: 'Family Business', category: 'other', categoryLabel: 'Other courses' }) };
      }
      return { ok: true, json: async () => ({ grants: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const codeInput = screen.getByLabelText(/add.*course.*code|course code/i);
    fireEvent.change(codeInput, { target: { value: 'ENTR 4080' } });
    fireEvent.blur(codeInput);

    await waitFor(() => expect(screen.getByText(/not in the clemson catalog/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Family Business' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText(/Added ENTR 4080 — Family Business to Other courses/)).toBeInTheDocument());
  });

  it('picker shortcut: typing an unlisted catalog-shaped code in the course filter offers to add it, and choosing it creates + selects the course', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/api/admin/access/catalog')) {
        return { ok: true, json: async () => ({ found: true, code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', onCourseList: false, baseCode: null, baseTitle: null }) };
      }
      if (url.includes('/api/admin/access/courses')) {
        return { ok: true, json: async () => ({ code: 'ECON 2120', title: 'Principles of Macroeconomics', category: 'other', categoryLabel: 'Other courses' }) };
      }
      return { ok: true, json: async () => ({ grants: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/search courses/i), { target: { value: 'ECON 2120' } });

    await waitFor(
      () => expect(screen.getByRole('button', { name: /add econ 2120.*principles of macroeconomics/i })).toBeInTheDocument(),
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByRole('button', { name: /add econ 2120/i }));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /ECON 2120/i })).toBeChecked());
  }, 10000);

  it('surfaces the server error message on a failed reissue (e.g. 409 admin-managed or expired)', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [grantRow()] }) }) // initial load
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'this grant is expired — edit the expiry first' }) }); // reissue
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AccessPanel slug="s" courses={courses} />);
    await waitFor(() => expect(screen.getByText('Danita Swaney')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /send a new link/i }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringMatching(/expired/i)));
  });
});
