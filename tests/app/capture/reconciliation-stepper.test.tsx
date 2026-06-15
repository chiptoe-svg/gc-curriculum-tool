import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReconciliationStepper } from '@/app/capture/[code]/ReconciliationStepper';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const profile = {
  course_code: 'GC 1', scale_version: 'v1', generated_at: 'now',
  competencies: [{ statement: 'Color mgmt', k_depth: 3, u_depth: 3, d_depth: 4, type: 'technical', source: 'materials' }],
  incoming_expectations: [], revised_objectives_draft: ['Deliver artwork'],
  verification_summary: { course_shape: 'x', strongest_evidence: ['e'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, course_emphasis: null,
} as unknown as CaptureProfile;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ proposals: [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'lower Do' }] }) }));
});

describe('ReconciliationStepper', () => {
  it('shows step 1 (apparent outcomes) + a feedback box', () => {
    render(<ReconciliationStepper profile={profile} slug="s" courseCode="GC 1" onComplete={() => {}} />);
    expect(screen.getByText(/Apparent outcomes/i)).toBeTruthy();
    expect(screen.getByText(/Deliver artwork/)).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
  it('submitting feedback fetches + renders proposals for accept', async () => {
    render(<ReconciliationStepper profile={profile} slug="s" courseCode="GC 1" onComplete={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'tighten this' } });
    fireEvent.click(screen.getByRole('button', { name: /make suggested change/i }));
    await waitFor(() => expect(screen.getByText(/lower Do/i)).toBeTruthy());
  });
});
