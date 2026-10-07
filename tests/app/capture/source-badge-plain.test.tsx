import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceBadge } from '@/app/capture/[code]/ProfileReviewPanel';

// Owner, 2026-10-07: the source tag reads in plain words, not capitalized
// codes ("INSTRUCTOR"), and says what it means.
describe('SourceBadge', () => {
  it.each([
    ['instructor', 'From your interview'],
    ['materials', 'From course materials'],
    ['inferred', "AI's inference"],
  ] as const)('%s reads "%s" in sentence case', (source, label) => {
    const { container } = render(<SourceBadge source={source} citations={[]} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uppercase/);
  });
});
