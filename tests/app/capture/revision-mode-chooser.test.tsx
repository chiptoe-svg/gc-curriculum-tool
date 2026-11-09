import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
vi.mock('@/components/VoiceRecorder', () => ({ VoiceRecorder: () => null }));
vi.mock('@/app/capture/[code]/CitationDrawer', () => ({ CitationDrawer: () => null }));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Instructor A'] }));

import { CaptureHero } from '@/app/capture/[code]/CaptureHero';
import { CaptureChatPanel } from '@/app/capture/[code]/CaptureChatPanel';

const PRIOR = { instructorName: 'Instructor A', createdAt: '2026-10-01T12:00:00Z' };

function hero(over: Partial<React.ComponentProps<typeof CaptureHero>> = {}) {
  const onModeChange = vi.fn();
  render(
    <CaptureHero courseCode="GC 3460" courseTitle="Flexo" materialsCount={3} instructor="Instructor A"
      onInstructorChange={() => {}} mode={null} onModeChange={onModeChange} priorSnapshotInfo={PRIOR} {...over} />,
  );
  return { onModeChange };
}

describe('revision mode chooser', () => {
  it('shows the three options with the approved wording', () => {
    hero();
    expect(screen.getByText("What's changed in this course since it was approved?")).toBeTruthy();
    expect(screen.getByText('A few specific things changed')).toBeTruthy();
    expect(screen.getByText('Tell us what changed. Every rating is checked again; any rating that moves without new evidence is set back to the approved version for you. You\'ll see each change and approve it before it counts.')).toBeTruthy();
    expect(screen.getByText('Re-check the whole course')).toBeTruthy();
    expect(screen.getByText('The approved version is the starting point, but every rating is checked again against your current materials and this conversation. You\'ll see what moved before approving.')).toBeTruthy();
    expect(screen.getByText('Start over')).toBeTruthy();
    expect(screen.getByText('Build a new profile from your current materials and the catalog, as if for the first time. The approved version stays in place until you approve the new one.')).toBeTruthy();
    expect(screen.getByText(/Instructor A · Oct 1, 2026/)).toBeTruthy();
  });

  it('nothing is selected; picking one reports its id', () => {
    const { onModeChange } = hero();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.every(r => !r.checked)).toBe(true);
    fireEvent.click(screen.getByLabelText(/Re-check the whole course/));
    expect(onModeChange).toHaveBeenCalledWith('recheck');
  });

  it('no snapshot shows no chooser', () => {
    hero({ priorSnapshotInfo: null });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/What's changed in this course/)).toBeNull();
  });
});

describe('chat panel with a revision mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 })));
  });

  function panel(over: Partial<React.ComponentProps<typeof CaptureChatPanel>> = {}) {
    render(
      <CaptureChatPanel courseCode="GC 3460" slug="s" messages={[]} onMessagesChange={() => {}} onGenerate={() => {}}
        sessionId={null} onSessionIdChange={() => {}} chooserInstructor="Instructor A" onInstructorChange={() => {}}
        chooserMode={null} onModeChange={() => {}} modeRequired {...over} />,
    );
  }

  it('start is disabled until a choice is made', () => {
    panel();
    expect((screen.getByRole('button', { name: /start the interview/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/choose what's changed above to start/i)).toBeTruthy();
  });

  it('sends the chosen mode with the request', async () => {
    panel({ chooserMode: 'targeted' });
    fireEvent.click(screen.getByRole('button', { name: /start the interview/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body));
    expect(body.revisionMode).toBe('targeted');
    expect(body.includePriorSessions).toBe(true);
  });

  it('resumed session shows its stored mode', () => {
    panel({ chooserMode: 'recheck', messages: [{ role: 'assistant', content: 'Hello' }] });
    expect(screen.getByText('Re-check the whole course')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
