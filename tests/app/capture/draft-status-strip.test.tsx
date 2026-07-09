import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DraftStatusStrip } from '@/app/capture/[code]/DraftStatusStrip';

describe('DraftStatusStrip', () => {
  it('shows status, last snapshot, and forked-from when present', () => {
    render(<DraftStatusStrip reviewerStatus="edited" lastSnapshotAt="2026-06-15T00:00:00.000Z" forkedFrom={{ caption: 'pre-trapping baseline', createdAt: '2026-06-15T00:00:00.000Z' }} />);
    const strip = screen.getByTestId('draft-status-strip');
    expect(within(strip).getByText(/working draft/i)).toBeInTheDocument();
    expect(within(strip).getByText(/edited/i)).toBeInTheDocument();
    expect(within(strip).getByText(/forked from/i)).toBeInTheDocument();
    expect(within(strip).getByText(/pre-trapping baseline/)).toBeInTheDocument();
  });
  it('omits forked-from when null and shows "never" with no snapshot', () => {
    render(<DraftStatusStrip reviewerStatus="ai_drafted" lastSnapshotAt={null} forkedFrom={null} />);
    const strip = screen.getByTestId('draft-status-strip');
    expect(within(strip).queryByText(/forked from/i)).toBeNull();
    expect(within(strip).getByText(/never/i)).toBeInTheDocument();
  });
});
