/**
 * Owner, 2026-10-07: the button reads "Voice", says the first use can be slow,
 * and while recording reads "Done" (not "Stop").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

describe('VoiceRecorder labels', () => {
  it('idle: reads "Voice" with a first-use note', () => {
    render(<VoiceRecorder slug="s" onTranscript={() => {}} />);
    expect(screen.getByRole('button', { name: /^voice/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^record/i })).toBeNull();
    expect(screen.getByText(/first recording can take a few extra seconds/i)).toBeTruthy();
  });

  it('recording: reads "Done" with the timer, not "Stop"', async () => {
    render(<VoiceRecorder slug="s" onTranscript={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^voice/i })); });
    expect(screen.getByRole('button', { name: /^done · 0:00/i })).toBeTruthy();
    expect(screen.queryByText(/stop/i)).toBeNull();
    expect(screen.queryByText(/first recording/i)).toBeNull();
  });
});
