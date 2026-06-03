'use client';

/**
 * Voice-bridge client component. Lives inside the iframe at the
 * Tailscale Funnel origin (HTTPS). Speaks postMessage protocol with
 * the parent (the main LAN-HTTP app):
 *
 *   parent → iframe :  { kind: 'set-token', token }
 *   parent → iframe :  { kind: 'start-record' }
 *   parent → iframe :  { kind: 'stop-record' }
 *   iframe → parent :  { kind: 'voice-bridge-ready' }   (on mount)
 *   iframe → parent :  { kind: 'recording', durationMs }
 *   iframe → parent :  { kind: 'transcribing' }
 *   iframe → parent :  { kind: 'transcript', text }
 *   iframe → parent :  { kind: 'error', message }
 *
 * Parent origin is validated from a `?parentOrigin=` query param the
 * parent embeds in the iframe URL. Only messages from the parent
 * origin are accepted; only messages TO the parent origin are sent.
 *
 * On mount: notifies parent we're ready (parent then posts back the
 * voice-session token). On subsequent start/stop messages: records and
 * transcribes via /api/transcribe (which is also served over the
 * Funnel) with the token in the X-Voice-Token header.
 */

import { useEffect, useRef, useState } from 'react';

interface MicStreamRefs {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  mimeType: string;
}

export function VoiceBridgeClient() {
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const refs = useRef<MicStreamRefs>({ stream: null, recorder: null, chunks: [], mimeType: '' });
  const [status, setStatus] = useState<string>('initializing…');

  // Read parentOrigin from query string. The parent embeds the iframe
  // with ?parentOrigin=<encoded http origin> so this iframe knows
  // exactly who to validate against and where to send postMessages.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('parentOrigin') ?? '';
    if (!raw || !/^https?:\/\/[^/]+$/.test(raw)) {
      setStatus('error: invalid parentOrigin query param');
      return;
    }
    setParentOrigin(raw);
  }, []);

  function postToParent(payload: Record<string, unknown>): void {
    if (!parentOrigin) return;
    window.parent.postMessage(payload, parentOrigin);
  }

  // Once we know the parent origin, announce readiness. Parent responds
  // with `set-token` to supply the voice-session token.
  useEffect(() => {
    if (!parentOrigin) return;
    setStatus('ready, waiting for token');
    postToParent({ kind: 'voice-bridge-ready' });
  }, [parentOrigin]);

  // Listen for parent commands.
  useEffect(() => {
    if (!parentOrigin) return;
    function handle(e: MessageEvent) {
      if (e.origin !== parentOrigin) return;
      const msg = e.data as { kind?: string; token?: string };
      if (!msg || typeof msg.kind !== 'string') return;
      switch (msg.kind) {
        case 'set-token':
          if (typeof msg.token === 'string' && msg.token.length > 0) {
            tokenRef.current = msg.token;
            setStatus('token received, idle');
          }
          break;
        case 'start-record':
          void startRecording();
          break;
        case 'stop-record':
          void stopRecording();
          break;
      }
    }
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [parentOrigin]);

  async function startRecording(): Promise<void> {
    try {
      // Reuse the existing stream if we have one (don't re-prompt for
      // permission across turns 2..N of the same audit session).
      if (!refs.current.stream) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        refs.current.stream = stream;
        // Pick a MIME the browser supports. Chrome → opus/webm; Safari → mp4.
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        refs.current.mimeType =
          candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
      }
      const stream = refs.current.stream;
      const recorder = new MediaRecorder(stream, refs.current.mimeType ? { mimeType: refs.current.mimeType } : undefined);
      refs.current.recorder = recorder;
      refs.current.chunks = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) refs.current.chunks.push(ev.data);
      };
      recorder.start();
      const startedAt = Date.now();
      setStatus('recording');
      postToParent({ kind: 'recording', durationMs: 0 });
      // Tick recording duration every 500ms while active.
      const tick = setInterval(() => {
        if (!recorder || recorder.state !== 'recording') {
          clearInterval(tick);
          return;
        }
        postToParent({ kind: 'recording', durationMs: Date.now() - startedAt });
      }, 500);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'mic permission failed';
      setStatus('error: ' + message);
      postToParent({ kind: 'error', message });
    }
  }

  async function stopRecording(): Promise<void> {
    const recorder = refs.current.recorder;
    if (!recorder || recorder.state !== 'recording') return;

    // Wait for the final ondataavailable event after stop().
    const finishedBlob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(refs.current.chunks, { type: refs.current.mimeType || 'audio/webm' });
        resolve(blob);
      };
      recorder.stop();
    });

    setStatus('transcribing');
    postToParent({ kind: 'transcribing' });

    const token = tokenRef.current;
    if (!token) {
      const message = 'no voice-session token; cannot transcribe';
      setStatus('error: ' + message);
      postToParent({ kind: 'error', message });
      return;
    }

    try {
      // Slug is encoded into the parentOrigin's url path on the parent
      // side, but the parent already validated the slug to mint the
      // token. We forward the slug too because /api/transcribe also
      // validates it for the rate-limit lookup.
      const slug = new URLSearchParams(window.location.search).get('slug') ?? '';
      const form = new FormData();
      form.append('audio', finishedBlob, 'mic.webm');
      const res = await fetch(`/api/transcribe?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'x-voice-token': token },
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? `transcribe failed (${res.status})`;
        setStatus('error: ' + message);
        postToParent({ kind: 'error', message });
        return;
      }
      const { text } = (await res.json()) as { text?: string };
      setStatus('idle');
      postToParent({ kind: 'transcript', text: text ?? '' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'transcribe network error';
      setStatus('error: ' + message);
      postToParent({ kind: 'error', message });
    }
  }

  // Visible status — only useful when debugging by opening the iframe URL
  // directly. In normal use the iframe is sized 1x1 and invisible.
  return (
    <div>
      <p>Voice bridge — {status}</p>
      <p style={{ color: '#888', fontSize: 10 }}>
        This page is a hidden iframe used by the main app to record voice
        input over HTTPS. It is not meant to be visited directly.
      </p>
    </div>
  );
}
