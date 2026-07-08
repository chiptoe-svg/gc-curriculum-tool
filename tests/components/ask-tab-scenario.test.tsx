import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AskTab } from '@/components/AskTab';
import type { Scenario } from '@/lib/ai/explore/scenario';

const scenario: Scenario = {
  id: 's1',
  courseCode: 'GC 3460',
  baselineSnapshotId: 'b',
  change: {
    prose: 'p',
    activity: 'trapping lab',
    artifact: 'graded',
    competencies: ['prepress'],
    rubricCriteria: [],
    assumesIncoming: [],
  },
  predictedDeltas: [
    {
      competency: 'prepress preparation',
      from: { k: 2, u: 2, d: 3 },
      to: { k: 2, u: 2, d: 4 },
      confidence: 'medium',
      rationale: 'r',
    },
  ],
  computedRipple: [],
  caption: null,
  createdAt: '2026-07-08T00:00:00.000Z',
};

// Mock VoiceRecorder so it doesn't blow up in jsdom
vi.mock('@/components/VoiceRecorder', () => ({
  VoiceRecorder: () => null,
}));

beforeEach(() => {
  global.fetch = vi.fn(async () => {
    const events = [
      { kind: 'scenario', scenario },
      { kind: 'final', response: { response: 'here is my read', citations: [] } },
    ];
    const body = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    return {
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          c.close();
        },
      }),
      text: async () => '',
    } as unknown as Response;
  });
});

describe('AskTab scenario card rendering', () => {
  it('renders an inline scenario card when a scenario event streams', async () => {
    render(
      <AskTab courseCode="GC 3460" courseTitle="X" slug="test-slug" />,
    );

    // AskTab uses an <input type="text"> inside a <form>; submit fires send().
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'what if I add a trapping lab?' } });

    const form = input.closest('form');
    if (form) {
      fireEvent.submit(form);
    } else {
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    // ScenarioCard renders the activity as the title (caption is null).
    // The header text is: `Scenario · "trapping lab"`
    await waitFor(() =>
      expect(screen.getByText(/trapping lab/i)).toBeInTheDocument(),
    );

    // The predicted delta competency name appears in a DeltaLine.
    // Scope to the scenario-cards container to avoid ambiguous matches.
    const cardsContainer = screen.getByTestId('scenario-cards');
    expect(cardsContainer).toBeTruthy();
    expect(cardsContainer.textContent).toContain('prepress preparation');
  });
});
