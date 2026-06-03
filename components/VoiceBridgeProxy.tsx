'use client';

/**
 * Mic recording button + invisible HTTPS iframe bridge.
 *
 * Replaces the legacy <VoiceRecorder /> on pages that need voice input.
 * Same external API (slug + onTranscript callback); internally it solves
 * the "main app is HTTP, mic requires HTTPS" problem by lazy-mounting a
 * hidden iframe pointed at the Tailscale Funnel HTTPS origin and
 * speaking postMessage with it.
 *
 * Architecture:
 *   1. Page load: nothing happens. Just a button.
 *   2. First click: fetch a voice-session token from /api/voice-session,
 *      then mount the iframe at <FUNNEL_ORIGIN>/voice-bridge.
 *   3. Iframe loads, posts {kind:'voice-bridge-ready'} back. We respond
 *      with {kind:'set-token', token} and {kind:'start-record'}.
 *   4. User clicks stop: post {kind:'stop-record'}. Iframe transcribes,
 *      posts {kind:'transcript', text}. We call onTranscript.
 *   5. Subsequent clicks (turns 2..N): iframe still mounted, token still
 *      valid, mic permission still granted — just post start/stop.
 *
 * Fallback: when TAILSCALE_FUNNEL_ORIGIN env isn't set (local dev /
 * pre-Tailscale-install state), we render a disabled button with a
 * tooltip explaining the situation. The legacy VoiceRecorder can be
 * mounted in those cases by the page; this component doesn't fall
 * through to it itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  slug: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type BridgeMessage =
  | { kind: 'voice-bridge-ready' }
  | { kind: 'recording'; durationMs: number }
  | { kind: 'transcribing' }
  | { kind: 'transcript'; text: string }
  | { kind: 'error'; message: string };

const FUNNEL_ORIGIN = process.env.NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN ?? '';

export function VoiceBridgeProxy({ slug, onTranscript, disabled }: Props) {
  const [iframeMounted, setIframeMounted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const tokenRef = useRef<string | null>(null);
  const queuedActionRef = useRef<'start' | null>(null);

  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== FUNNEL_ORIGIN) return;
    const msg = event.data as BridgeMessage;
    if (!msg || typeof msg.kind !== 'string') return;
    switch (msg.kind) {
      case 'voice-bridge-ready': {
        // Iframe loaded. Send the token + any queued start command.
        const win = iframeRef.current?.contentWindow;
        if (win && tokenRef.current) {
          win.postMessage({ kind: 'set-token', token: tokenRef.current }, FUNNEL_ORIGIN);
          if (queuedActionRef.current === 'start') {
            win.postMessage({ kind: 'start-record' }, FUNNEL_ORIGIN);
            queuedActionRef.current = null;
            setRecording(true);
          }
        }
        break;
      }
      case 'recording':
        setDurationMs(msg.durationMs);
        break;
      case 'transcribing':
        setRecording(false);
        setTranscribing(true);
        break;
      case 'transcript':
        setTranscribing(false);
        setDurationMs(0);
        if (msg.text && msg.text.length > 0) onTranscript(msg.text);
        break;
      case 'error':
        setRecording(false);
        setTranscribing(false);
        setError(msg.message);
        break;
    }
  }, [onTranscript]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  async function fetchToken(): Promise<string | null> {
    setError(null);
    try {
      const res = await fetch(`/api/voice-session?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `voice-session failed (${res.status})`);
        return null;
      }
      const { token } = await res.json() as { token: string };
      return token;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'voice-session network error');
      return null;
    }
  }

  async function handleClick(): Promise<void> {
    if (disabled) return;
    setError(null);

    // Recording in progress → stop.
    if (recording) {
      const win = iframeRef.current?.contentWindow;
      if (win) win.postMessage({ kind: 'stop-record' }, FUNNEL_ORIGIN);
      return;
    }

    // First click: fetch token, mount iframe. The iframe-ready handler
    // posts the token + start command once the iframe is loaded.
    if (!iframeMounted) {
      const token = await fetchToken();
      if (!token) return;
      tokenRef.current = token;
      queuedActionRef.current = 'start';
      setIframeMounted(true);
      // Set recording=true optimistically; the ready+start sequence in
      // handleMessage will keep it true. If something fails, the error
      // path resets it.
      setRecording(true);
      return;
    }

    // Subsequent click: iframe already mounted + token in hand. Just start.
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ kind: 'start-record' }, FUNNEL_ORIGIN);
      setRecording(true);
    }
  }

  if (!FUNNEL_ORIGIN) {
    return (
      <button
        type="button"
        disabled
        title="Voice input requires NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN env var (Tailscale Funnel not configured)."
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-50 cursor-not-allowed"
      >
        🎤 Voice (offline)
      </button>
    );
  }

  const buttonLabel = transcribing
    ? 'Transcribing…'
    : recording
      ? `⏹ Stop (${Math.floor(durationMs / 1000)}s)`
      : '🎤 Voice';

  const parentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const iframeSrc = `${FUNNEL_ORIGIN}/voice-bridge?slug=${encodeURIComponent(slug)}&parentOrigin=${encodeURIComponent(parentOrigin)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || transcribing}
        title={recording ? 'Click to stop and transcribe' : 'Click to record voice input'}
        className={
          'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium '
          + (recording ? 'text-red-600 hover:bg-red-50' : 'text-foreground hover:bg-muted')
          + ' disabled:opacity-50'
        }
      >
        {buttonLabel}
      </button>
      {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      {iframeMounted && (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          // Hidden in normal use; the bridge communicates over postMessage.
          // Width/height 0 hides it without unmounting; absolute positioning
          // keeps it out of the document flow.
          style={{ width: 0, height: 0, border: 0, position: 'absolute', visibility: 'hidden' }}
          title="Voice bridge"
          allow="microphone"
        />
      )}
    </>
  );
}
