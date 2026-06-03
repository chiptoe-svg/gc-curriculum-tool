'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Slug to authenticate against the `/api/transcribe` endpoint. */
  slug: string;
  /** Called with the transcribed text once Whisper returns. */
  onTranscript: (text: string) => void;
  /** Optional disabled flag — usually true while the consumer is busy. */
  disabled?: boolean;
  /** Soft cap on recording duration (ms). Default 5 minutes. */
  maxDurationMs?: number;
}

type Status = 'idle' | 'recording' | 'transcribing' | 'error';
type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

/**
 * Browser audio capture + Whisper transcription button.
 *
 * Clicking the button toggles between idle and recording. On stop, the
 * captured Blob is POSTed to `/api/transcribe`; the returned text is passed
 * to `onTranscript`. The consumer decides what to do with it (typically
 * append to a text input rather than auto-send).
 *
 * `MediaRecorder` output format depends on browser — Chrome produces
 * `audio/webm;codecs=opus`, which Whisper handles natively. Safari emits
 * mp4/m4a which Whisper also accepts. We let the browser pick and pass the
 * resulting MIME type to the server.
 *
 * Permission UX: on mount we query the Permissions API to surface a visible
 * "Mic blocked" hint before the user even clicks, so a previously-denied
 * permission isn't a silent failure. Browsers that don't expose the
 * Permissions API for microphone (older Safari) leave the state at 'unknown'
 * and the error is surfaced from the catch block instead.
 */
export function VoiceRecorder({ slug, onTranscript, disabled, maxDurationMs = 5 * 60 * 1000 }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Permissions API probe: tells us up-front if the mic was previously denied,
  // so we can show "Mic blocked" guidance before the user clicks instead of
  // making them discover it via a failed click.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(p => {
        if (cancelled) return;
        setPermission(p.state as PermissionState);
        p.onchange = () => {
          if (!cancelled) setPermission(p.state as PermissionState);
        };
      })
      .catch(() => {
        // Some browsers (older Safari) reject the query for 'microphone' even
        // though the API exists. Leave state at 'unknown' and rely on
        // getUserMedia's error to communicate.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startRecording() {
    setMessage('');
    setStatus('recording');
    setElapsedMs(0);

    let stream: MediaStream;
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('NotSecureContext');
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const err = e as DOMException & { name?: string; message?: string };
      setStatus('error');
      // Distinguish error kinds so the message is actionable, not generic.
      if (err.message === 'NotSecureContext' || (typeof window !== 'undefined' && !window.isSecureContext)) {
        setMessage('Mic requires HTTPS. Open this page via the secure URL (the Edit link from the public landing).');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMessage('Mic permission was denied. In Safari: Settings → Websites → Microphone → set this site to Allow, then refresh.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setMessage('No microphone device found. Connect a mic and try again.');
      } else if (err.name === 'NotReadableError') {
        setMessage('Microphone is in use by another application. Close it and retry.');
      } else {
        setMessage(`Mic error: ${err.message || err.name || 'unknown'}`);
      }
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setStatus('error');
      setMessage('This browser does not support audio recording.');
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      void uploadRecording();
    };
    recorder.start();

    // Live duration ticker — updates every 250ms during recording.
    const startedAt = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
    }, maxDurationMs);
  }

  function stopRecording() {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
  }

  async function uploadRecording() {
    setStatus('transcribing');
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;

    const mimeType = recorder?.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    if (blob.size === 0) {
      setStatus('idle');
      setMessage('No audio captured.');
      return;
    }

    const form = new FormData();
    form.append('audio', blob, 'recording');

    try {
      const res = await fetch(`/api/transcribe?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage((json as { error?: string }).error ?? `Transcription failed (${res.status})`);
        return;
      }
      const text = (json as { text?: string }).text ?? '';
      onTranscript(text);
      setStatus('idle');
      setMessage('');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Transcription failed');
    }
  }

  function handleClick() {
    if (status === 'recording') stopRecording();
    else if (status === 'idle' || status === 'error') void startRecording();
  }

  // MM:SS for the live timer; updated every 250ms during recording.
  const mm = Math.floor(elapsedMs / 60000);
  const ss = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, '0');
  const timer = `${mm}:${ss}`;

  const label =
    status === 'recording' ? `Stop · ${timer}`
      : status === 'transcribing' ? 'Transcribing…'
      : status === 'error' ? 'Retry'
      : 'Record';

  const icon =
    status === 'recording' ? '⏹'
      : status === 'transcribing' ? '…'
      : '🎤';

  // Surface a "Mic blocked" hint before the user clicks, if the Permissions
  // API tells us so. The full actionable message still appears on click via
  // the catch path.
  const preflightHint = status === 'idle' && permission === 'denied'
    ? 'Mic blocked at the browser level — see Safari → Settings → Websites → Microphone.'
    : null;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || status === 'transcribing'}
        aria-label={label}
        title={preflightHint ?? label}
        className={
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium shadow-sm transition '
          + (status === 'recording'
            ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 tabular-nums'
            : status === 'error' || permission === 'denied'
              ? 'border-red-300 bg-background text-red-700 hover:bg-red-50'
              : 'border-input bg-background text-muted-foreground hover:bg-muted')
          + ' disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      {(message || preflightHint) && (
        <div
          role={status === 'error' ? 'alert' : undefined}
          className={
            'max-w-md rounded border px-2 py-1 text-xs '
            + (status === 'error' || permission === 'denied'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-input bg-muted text-muted-foreground')
          }
        >
          {message || preflightHint}
        </div>
      )}
    </div>
  );
}
