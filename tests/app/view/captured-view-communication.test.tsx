import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapturedView } from '@/app/view/[code]/CapturedView';
import { baseProfile, foundationalRow as row } from '@/tests/helpers/capture-profile-fixture';

describe('CapturedView foundational communication rows', () => {
  it('renders an old snapshot with one plain Communication row', () => {
    render(<CapturedView profile={baseProfile([row('Communication', 'oral and written rubric')])} capturedAt="2026-06-01" />);
    expect(screen.getByText('Communication')).toBeTruthy();
    expect(screen.getByText(/oral and written rubric/)).toBeTruthy();
  });

  it('renders a new snapshot with Written and Spoken rows', () => {
    render(
      <CapturedView
        profile={baseProfile([row('Written Communication', 'graded reports'), row('Spoken Communication', 'graded pitch')])}
        capturedAt="2026-10-20"
      />,
    );
    expect(screen.getByText('Written Communication')).toBeTruthy();
    expect(screen.getByText('Spoken Communication')).toBeTruthy();
    expect(screen.getByText(/graded reports/)).toBeTruthy();
    expect(screen.getByText(/graded pitch/)).toBeTruthy();
  });
});
