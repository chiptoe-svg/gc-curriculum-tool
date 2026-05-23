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
 */
export function VoiceRecorder({ slug, onTranscript, disabled, maxDurationMs = 5 * 60 * 1000 }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function startRecording() {
    setMessage('');
    setStatus('recording');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('error');
      setMessage('Microphone access was blocked. Allow it in your browser to use voice input.');
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

  const label =
    status === 'recording' ? 'Stop recording'
      : status === 'transcribing' ? 'Transcribing…'
      : status === 'error' ? 'Retry recording'
      : 'Record';

  const icon =
    status === 'recording' ? '⏹'
      : status === 'transcribing' ? '…'
      : '🎤';

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || status === 'transcribing'}
        aria-label={label}
        title={label}
        className={
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium shadow-sm transition '
          + (status === 'recording'
            ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-input bg-background text-muted-foreground hover:bg-muted')
          + ' disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      {message && (
        <p className={
          'text-xs ' + (status === 'error' ? 'text-destructive' : 'text-muted-foreground')
        }>
          {message}
        </p>
      )}
    </div>
  );
}
