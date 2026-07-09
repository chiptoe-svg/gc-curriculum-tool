import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InputsDriftBanner } from '@/app/capture/[code]/InputsDriftBanner';
import type { InputsDrift } from '@/lib/capture/inputs-drift';

const drift = (over: Partial<InputsDrift> = {}): InputsDrift => ({
  available: true, added: [], removed: [], changed: [], canvasChanged: false, docsChanged: false, hasDrift: false, ...over,
});

describe('InputsDriftBanner', () => {
  it('renders the banner + specifics when there is drift', () => {
    render(<InputsDriftBanner drift={drift({ hasDrift: true, added: [{ id: 'a', fileName: 'new.pdf' }], removed: [{ id: 'b', fileName: 'gone.pdf' }] })} />);
    const banner = screen.getByTestId('inputs-drift-banner');
    expect(within(banner).getByText(/materials have changed/i)).toBeInTheDocument();
    expect(within(banner).getByText(/new\.pdf/)).toBeInTheDocument();
    expect(within(banner).getByText(/gone\.pdf/)).toBeInTheDocument();
  });
  it('renders nothing when drift is null', () => {
    render(<InputsDriftBanner drift={null} />);
    expect(screen.queryByTestId('inputs-drift-banner')).toBeNull();
  });
  it('renders nothing when available with no drift', () => {
    render(<InputsDriftBanner drift={drift({ hasDrift: false })} />);
    expect(screen.queryByTestId('inputs-drift-banner')).toBeNull();
  });
  it('shows the record-unavailable note for a legacy snapshot', () => {
    render(<InputsDriftBanner drift={drift({ available: false, hasDrift: false })} />);
    const banner = screen.getByTestId('inputs-drift-banner');
    expect(within(banner).getByText(/inputs record unavailable/i)).toBeInTheDocument();
  });
});
