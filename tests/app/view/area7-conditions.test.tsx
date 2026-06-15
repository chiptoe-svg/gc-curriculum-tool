import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Area7Conditions } from '@/app/view/[code]/CapturedView';

describe('Area7Conditions', () => {
  it('renders the five conditions with their states when the block is present', () => {
    render(<Area7Conditions block={{
      generate_then_consolidate: 'present', open_ended_problems: 'partial',
      revision_cycles: 'absent', structured_post_mortem: 'present',
      abstraction_bridging: 'present', max_supporting_depth: 4,
    }} />);
    expect(screen.getByText(/Generate-then-consolidate/i)).toBeTruthy();
    expect(screen.getByText(/Abstraction-and-bridging/i)).toBeTruthy();
    expect(screen.getByText(/D 4/i)).toBeTruthy();
  });

  it('shows "not assessed" for a missing abstraction_bridging (old snapshot back-compat)', () => {
    render(<Area7Conditions block={{
      generate_then_consolidate: 'present', open_ended_problems: 'present',
      revision_cycles: 'present', structured_post_mortem: 'absent', max_supporting_depth: 3,
    }} />);
    const ab = screen.getByText(/Abstraction-and-bridging/i).closest('li')!;
    expect(ab.textContent).toMatch(/not assessed/i);
  });

  it('renders nothing when the block is null', () => {
    const { container } = render(<Area7Conditions block={null} />);
    expect(container.firstChild).toBeNull();
  });
});
