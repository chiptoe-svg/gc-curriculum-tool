import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BundlesPanel, type BundleListItem, type BundleDetail } from '../BundlesPanel';

const ATTRIBUTION = 'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.';

const bundlesFixture: BundleListItem[] = [
  { id: 'comm-writing', name: 'Written communication', stratum: 'foundational', sampled: false, submitted: false, counts: { proposed: 2, confirmed: 1, rejected: 0 }, noCleanMatch: false },
  { id: 'locked-one', name: 'Locked bundle', stratum: null, sampled: true, submitted: false, counts: null, noCleanMatch: null },
  { id: 'blind-ready', name: 'Blind ready bundle', stratum: 'technical', sampled: true, submitted: false, counts: null, noCleanMatch: null },
];

const blindReadyDetail: BundleDetail = {
  bundle: { id: 'blind-ready', name: 'Blind ready bundle', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', origin: 'o' },
  card: { stratum: 'technical', includes: 'inc', excludes: 'exc', distinctions: 'dist', positiveExamples: ['e1', 'e2'], negativeExamples: ['n1', 'n2'] },
  elements: [{ elementId: '2.B.5.a', elementName: 'Element Name', domain: 'Basic Skills', description: 'Definition text' }],
  sample: {
    candidates: [{ key: '0123456789abcdef', label: 'Task label', rank: 1, score: 0.9, members: [{ taskId: 't1', onetSocCode: '15-1254.00' }] }],
    submitted: false, reviewer: null, picks: [],
  },
  members: null,
  latestOutcome: null,
  attribution: ATTRIBUTION,
};

const queueBundle: BundleListItem = { id: 'queue-bundle', name: 'Queue bundle', stratum: 'technical', sampled: false, submitted: false, counts: { proposed: 2, confirmed: 0, rejected: 0 }, noCleanMatch: false };

const queueDetail: BundleDetail = {
  bundle: { id: 'queue-bundle', name: 'Queue bundle', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', origin: 'o' },
  card: null,
  elements: [],
  sample: null,
  members: [
    { id: 'm1', source: 'onet_task', externalId: 't1', externalLabel: 'Shared task', onetSocCode: '15-1254.00', position: 'core', aiPosition: 'core', status: 'proposed', proposedBy: 'model-x', rationale: 'r', reviewNote: null, bulkConfirmed: false },
    { id: 'm2', source: 'onet_task', externalId: 't1', externalLabel: 'Shared task', onetSocCode: '15-1255.00', position: 'core', aiPosition: 'core', status: 'proposed', proposedBy: 'model-x', rationale: 'r', reviewNote: null, bulkConfirmed: false },
  ],
  latestOutcome: { noCleanMatch: false, note: null },
  attribution: ATTRIBUTION,
};

function pathOf(url: string): string {
  return new URL(url, 'http://h').pathname;
}

function listResponse(bundles: BundleListItem[]) {
  return { ok: true, json: async () => ({ bundles, progress: { reviewed: 0, total: bundles.length }, attribution: ATTRIBUTION }) };
}

function detailResponse(detail: BundleDetail) {
  return { ok: true, json: async () => detail };
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('BundlesPanel', () => {
  it('disables action buttons until a reviewer name is entered, and shows the attribution text', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse(bundlesFixture);
      if (p === '/api/admin/bundles/blind-ready') return detailResponse(blindReadyDetail);
      if (p === '/api/admin/bundles/agreement') return { ok: true, json: async () => ({ rows: [], total: { bundleId: 'ALL', aiCount: 0, blindCount: 0, both: 0, precision: null, recall: null, exact: 0, withinOne: 0, blindTasksOutsideShortlist: 0 }, kappas: [], noMatch: [], notYetMapped: [], attribution: ATTRIBUTION }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByText('Blind ready bundle')).toBeInTheDocument());
    expect(screen.getByText(ATTRIBUTION)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Blind ready bundle'));
    await waitFor(() => expect(screen.getByRole('button', { name: /submit blind pick/i })).toBeInTheDocument());

    expect(screen.getByText(/enter your name to review/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit blind pick/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reviewer name/i), { target: { value: 'Chip' } });
    expect(screen.queryByText(/enter your name to review/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit blind pick/i })).not.toBeDisabled();
  });

  it('the reviewer name persists to localStorage and survives a remount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse(bundlesFixture));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/reviewer name/i), { target: { value: 'Chip' } });
    unmount();

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByLabelText(/reviewer name/i)).toHaveValue('Chip'));
  });

  it('a blind-locked bundle in the queue cannot be opened and shows "Blind pick first"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse(bundlesFixture);
      if (p === '/api/admin/bundles/agreement') return { ok: true, json: async () => ({ rows: [], total: { bundleId: 'ALL', aiCount: 0, blindCount: 0, both: 0, precision: null, recall: null, exact: 0, withinOne: 0, blindTasksOutsideShortlist: 0 }, kappas: [], noMatch: [], notYetMapped: [], attribution: ATTRIBUTION }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByText('Locked bundle')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /review queue/i }));

    const lockedRow = within(screen.getByText('Locked bundle').closest('div') as HTMLElement);
    expect(lockedRow.getByText(/blind pick first/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Locked bundle' })).not.toBeInTheDocument();
  });

  it('Submit sends the element pick to the blind route, with the task left as not a member', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse(bundlesFixture);
      if (p === '/api/admin/bundles/blind-ready') return detailResponse(blindReadyDetail);
      if (p === '/api/admin/bundles/blind-ready/blind' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, reconcile: { confirmed: 1, added: 0, disagreements: 0 } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByText('Blind ready bundle')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/reviewer name/i), { target: { value: 'Chip' } });
    fireEvent.click(screen.getByText('Blind ready bundle'));
    await waitFor(() => expect(screen.getByText('Element Name')).toBeInTheDocument());

    const elementRow = within(screen.getByText('Element Name').closest('div') as HTMLElement);
    fireEvent.click(elementRow.getByLabelText(/^core$/i));

    fireEvent.click(screen.getByRole('button', { name: /submit blind pick/i }));

    await waitFor(() => expect(screen.getByText(/submitted\. 1 confirmed, 0 added, 0 sent/i)).toBeInTheDocument());

    const call = fetchMock.mock.calls.find((c) => pathOf(c[0] as string) === '/api/admin/bundles/blind-ready/blind')!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({
      slug: 's', reviewer: 'Chip', noCleanMatch: false,
      picks: [{ kind: 'element', elementId: '2.B.5.a', position: 'core' }],
    });
  });

  it('"No clean match" disables the radios and sends an empty picks array', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse(bundlesFixture);
      if (p === '/api/admin/bundles/blind-ready') return detailResponse(blindReadyDetail);
      if (p === '/api/admin/bundles/blind-ready/blind' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, reconcile: { confirmed: 0, added: 0, disagreements: 0 } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByText('Blind ready bundle')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/reviewer name/i), { target: { value: 'Chip' } });
    fireEvent.click(screen.getByText('Blind ready bundle'));
    await waitFor(() => expect(screen.getByText('Element Name')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/no clean match/i));
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /submit blind pick/i }));
    await waitFor(() => expect(screen.getByText(/submitted\. 0 confirmed, 0 added, 0 sent/i)).toBeInTheDocument());

    const call = fetchMock.mock.calls.find((c) => pathOf(c[0] as string) === '/api/admin/bundles/blind-ready/blind')!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ slug: 's', reviewer: 'Chip', noCleanMatch: true, picks: [] });
  });

  it('grouped task rows send all of their member ids on Confirm, and a 409 shows its error text', async () => {
    let membersResult: { ok: boolean; status?: number; body: unknown } = { ok: false, status: 409, body: { error: 'blind sample not submitted' } };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse([queueBundle]);
      if (p === '/api/admin/bundles/queue-bundle') return detailResponse(queueDetail);
      if (p === '/api/admin/bundles/agreement') return { ok: true, json: async () => ({ rows: [], total: { bundleId: 'ALL', aiCount: 0, blindCount: 0, both: 0, precision: null, recall: null, exact: 0, withinOne: 0, blindTasksOutsideShortlist: 0 }, kappas: [], noMatch: [], notYetMapped: [], attribution: ATTRIBUTION }) };
      if (p === '/api/admin/bundles/queue-bundle/members' && init?.method === 'POST') {
        return { ok: membersResult.ok, status: membersResult.status, json: async () => membersResult.body };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/reviewer name/i), { target: { value: 'Chip' } });
    fireEvent.click(screen.getByRole('button', { name: /review queue/i }));
    fireEvent.click(screen.getByText('Queue bundle'));
    await waitFor(() => expect(screen.getByText(/shared task/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(screen.getByText(/blind sample not submitted/i)).toBeInTheDocument());
    const call = fetchMock.mock.calls.find((c) => pathOf(c[0] as string) === '/api/admin/bundles/queue-bundle/members')!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ slug: 's', reviewer: 'Chip', action: 'confirm', memberIds: ['m1', 'm2'] });

    // retry, now succeeding
    membersResult = { ok: true, body: { ok: true, changed: 2 } };
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(screen.queryByText(/blind sample not submitted/i)).not.toBeInTheDocument());
  });
});
