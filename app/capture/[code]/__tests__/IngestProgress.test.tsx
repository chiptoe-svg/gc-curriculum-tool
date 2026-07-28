import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IngestProgress } from '../IngestProgress';

describe('IngestProgress', () => {
  it('shows progress + a human ETA while in-flight', () => {
    render(<IngestProgress status={{ total: 3, done: 1, failed: 0, etaSeconds: 90 }} />);
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/~2 min|~1 min/)).toBeInTheDocument();
  });

  it('surfaces a failed count when present', () => {
    render(<IngestProgress status={{ total: 5, done: 2, failed: 1, etaSeconds: 30 }} />);
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('renders nothing when complete', () => {
    const { container } = render(
      <IngestProgress status={{ total: 3, done: 3, failed: 0, etaSeconds: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no materials', () => {
    const { container } = render(
      <IngestProgress status={{ total: 0, done: 0, failed: 0, etaSeconds: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
