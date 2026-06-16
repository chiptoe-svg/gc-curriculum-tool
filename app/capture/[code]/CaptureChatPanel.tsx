'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import type { CaptureReadiness } from '@/lib/ai/capture/schema';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';
import { CitationDrawer, type CitationTarget } from './CitationDrawer';
import { FACULTY_ROSTER } from '@/lib/faculty';

// Re-export so existing imports from this module keep working.
export type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

// Heuristic: did the audit cover problem-solving (Audit Area 7)? The agent's
// readiness `covered` topics are free-form prose, so we substring-match a small
// token set. A soft nudge only — a false negative just shows an extra prompt,
// a false positive just skips it; neither corrupts data (the profile records PF
// honestly regardless).
const PROBLEM_SOLVING_TOKENS = [
  'productive failure', 'problem-solving', 'problem solving',
  'post-mortem', 'post mortem',
  // 'reflection' is intentionally broad — coveredEver entries are agent-authored
  // topic labels (noun phrases), so this almost always means reflective practice,
  // not e.g. optical reflection. A stray match only skips a soft nudge.
  'reflection', 'area 7',
];
export function coveredIncludesProblemSolving(topics: string[]): boolean {
  return topics.some(t => {
    const s = t.toLowerCase();
    return PROBLEM_SOLVING_TOKENS.some(tok => s.includes(tok));
  });
}

export interface SessionBriefingView {
  sessionId: string;
  startedAt: string; // ISO — Date is not passed across the RSC boundary here
  turnCount: number;
  readiness: { score: number | null; covered: string[]; remaining: string[] };
  stickyFindings: Array<{ text: string }>;
  /** Mirrors the briefing shape; carried but not yet rendered — reserved for a future "Faculty last said" line. */
  lastFacultyTurn: string | null;
}

async function readNdjson(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error('no body to stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed lines — server only emits valid JSON per line
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail)); } catch { /* ignore */ }
  }
}

function ReadinessStrip({
  readiness,
  peakScore,
  coveredEver,
}: {
  readiness: CaptureReadiness;
  /** Highest score the agent has reported across this session. */
  peakScore: number;
  /** Union of covered topics across every turn in this session. */
  coveredEver: string[];
}) {
  const tone =
    readiness.score >= 75 ? 'bg-green-500'
      : readiness.score >= 50 ? 'bg-amber-500'
      : 'bg-slate-400';
  // A meaningful regression — the agent dropped its estimate by ≥15 points
  // from a previous high. Almost always means the catalog changed (faculty
  // edited objectives / skills) and the agent is honestly re-probing the
  // new scope. Surface the prior peak so faculty don't read this as state
  // loss or a bug.
  const regressed = peakScore - readiness.score >= 15;
  return (
    <div className="border-t bg-muted/20 px-4 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Interviewer readiness
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${tone}`}
            style={{ width: `${readiness.score}%` }}
          />
        </div>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {readiness.score}%
          {regressed && (
            <span
              className="ml-1 text-amber-700"
              title={`Earlier in this session the agent reported ${peakScore}%. The drop usually means the catalog (objectives, skills) changed and the agent is re-probing — not a state-loss bug. Coverage from earlier turns is preserved in the cumulative list below.`}
            >
              (↓ from {peakScore}% — re-probing)
            </span>
          )}
        </span>
        {readiness.good_enough_to_generate && (
          <span
            className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800"
            title="The interviewer reports it has enough evidence to generate a defensible profile."
          >
            ready
          </span>
        )}
      </div>
      {coveredEver.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Covered (this session):</span>{' '}
          {coveredEver.join(' · ')}
        </p>
      )}
      {readiness.remaining.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Still probing:</span>{' '}
          {readiness.remaining.join(' · ')}
        </p>
      )}
    </div>
  );
}

interface Props {
  courseCode: string;
  slug: string;
  messages: ChatMessage[];
  onMessagesChange: (next: ChatMessage[]) => void;
  onGenerate: () => void;
  /** When restoring a saved conversation, the last readiness captured. */
  initialReadiness?: CaptureReadiness | null;
  /** Called after each successful turn so the parent can persist progress. */
  onConversationChange?: (messages: ChatMessage[], readiness: CaptureReadiness | null) => void;
  /** Auditor identity — controlled by CaptureClient (single source; shared with the landing hero's chooser + the start request). */
  chooserInstructor: string;
  onInstructorChange: (v: string) => void;
  /** Build-on-prior vs. fresh — controlled by CaptureClient. */
  chooserMode: 'fresh' | 'continue';
  onModeChange: (v: 'fresh' | 'continue') => void;
  /** Distilled recap of prior sessions for the "Where we left off" card. Empty/omitted hides the card. */
  priorBriefings?: SessionBriefingView[];
}

// The chat panel renders the full transcript, the input row with text +
// voice + send, a "Start session" button when no messages yet, and a
// "Generate Course Outcome Profile" button below the chat that activates after at least
// one assistant reply has been received.
export function CaptureChatPanel({
  courseCode,
  slug,
  messages,
  onMessagesChange,
  onGenerate,
  initialReadiness,
  onConversationChange,
  chooserInstructor,
  onInstructorChange,
  chooserMode,
  onModeChange,
  priorBriefings,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<CaptureReadiness | null>(initialReadiness ?? null);
  // `chooserInstructor` / `chooserMode` are controlled by CaptureClient now —
  // the landing hero is the chooser surface, this panel's always-visible
  // "Auditor: X · change" badge is the mid-session surface, and both read/write
  // the same single source.
  // Toggles the inline dropdown next to the always-visible badge — lets
  // faculty change identity mid-session without leaving the audit page.
  const [editingInstructor, setEditingInstructor] = useState(false);
  // Session-cumulative counterparts to readiness. peakScore tracks the
  // highest score the agent reported; coveredEver is the union of all
  // covered-topic lists. Reset when the conversation resets.
  const [peakScore, setPeakScore] = useState<number>(initialReadiness?.score ?? 0);
  const [coveredEver, setCoveredEver] = useState<string[]>(initialReadiness?.covered ?? []);
  // Set on the first v2 turn that responds with a sessionId; threaded back on
  // every subsequent request so the audit-agent loop can stitch the
  // conversation together server-side. v1 responses leave this null.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function postChat(next: ChatMessage[]) {
    setBusy(true);
    setError(null);

    // Optimistically push an empty assistant message so deltas have a place
    // to land. We replace it on each delta and reconcile at 'final'.
    let streamed = '';
    let toolBanner = '';
    const optimistic: ChatMessage = { role: 'assistant', content: '' };
    onMessagesChange([...next, optimistic]);

    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/chat?slug=${encodeURIComponent(slug)}&stream=1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({
            messages: next,
            ...(sessionId ? { sessionId } : {}),
            instructorName: chooserInstructor,
            // Only "fresh" sessions skip the prior-sessions block. Once a
            // session has started (sessionId set), the choice doesn't
            // change behavior — but we send it anyway so the server can
            // validate consistency if it wants.
            includePriorSessions: chooserMode !== 'fresh',
          }),
        },
      );
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `Chat failed (${res.status})`);
        // Drop the optimistic empty assistant turn.
        onMessagesChange(next);
        return;
      }

      type FinalResponse = {
        finding?: string;
        question?: string;
        citations?: ChatMessage['citations'];
        readiness?: CaptureReadiness;
      };
      let finalResponse: FinalResponse | null = null;

      await readNdjson(res, (ev) => {
        const e = ev as { kind: string } & Record<string, unknown>;
        if (e.kind === 'session' && typeof e.sessionId === 'string') {
          setSessionId(e.sessionId);
        } else if (e.kind === 'tool-start' && typeof e.toolName === 'string') {
          toolBanner = `Searching materials via ${e.toolName}…`;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: toolBanner },
          ]);
        } else if (e.kind === 'text-delta' && typeof e.delta === 'string') {
          // Accumulate but don't render — structured-output streaming
          // emits raw JSON tokens as they're built, and showing that
          // mid-stream looks like garbage to the user. Wait for the
          // `final` event to swap in the validated text.
          streamed += e.delta;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: toolBanner || 'Thinking…' },
          ]);
        } else if (e.kind === 'final' && e.response && typeof e.response === 'object') {
          finalResponse = e.response as FinalResponse;
        } else if (e.kind === 'error' && typeof e.message === 'string') {
          setError(e.message);
        }
      });

      if (!finalResponse) {
        if (!streamed) onMessagesChange(next);
        return;
      }

      const fr: FinalResponse = finalResponse;
      // Some agent turns include the question text inside the `finding`
      // paragraph (the prompt asks for 3 paragraphs of prose AND splits
      // into structured finding + question fields — agents satisfy both
      // by writing the question into both). Append `question` only when
      // it's not already part of `finding`, so faculty don't see it twice.
      const finding = (fr.finding ?? '').trim();
      const question = (fr.question ?? '').trim();
      const content = !question
        ? finding
        : finding.includes(question)
          ? finding
          : finding + '\n\n' + question;
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content,
        ...(Array.isArray(fr.citations) && fr.citations.length > 0
          ? { citations: fr.citations }
          : {}),
      };
      const newMessages = [...next, assistantMessage];
      onMessagesChange(newMessages);
      if (fr.readiness) {
        setReadiness(fr.readiness);
        // Track session-cumulative progress so a per-turn score drop
        // (typical after faculty edits the catalog mid-audit) doesn't
        // erase the coverage history the user can already see.
        setPeakScore(prev => Math.max(prev, fr.readiness!.score));
        setCoveredEver(prev => Array.from(new Set([...prev, ...fr.readiness!.covered])));
      }
      onConversationChange?.(newMessages, fr.readiness ?? readiness ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
      onMessagesChange(next);
    } finally {
      setBusy(false);
    }
  }

  // Empty messages array signals an "opening turn" to the chat route;
  // the v2 audit agent self-introduces from at-rest context (no fake
  // user message is written to the transcript). v1 path also handles
  // empty messages by self-introducing.
  async function handleStart() {
    await postChat([]);
  }

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: t }];
    onMessagesChange(next);
    await postChat(next);
  }
  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await sendText(text);
  }
  const ONE_LAST_QUESTION = "I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words.";
  async function handleOneLastQuestion() {
    await sendText(ONE_LAST_QUESTION);
  }

  function appendTranscript(text: string) {
    if (!text) return;
    setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
  }

  const canGenerate = messages.some(m => m.role === 'assistant');

  function handleGenerateClick() {
    onGenerate();
  }

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Interview conversation</h2>
          <p className="text-xs text-muted-foreground">
            The interviewer reads everything already in the system and asks clarifying questions about
            prereqs, stated vs. evidenced outcomes, and any contradictions across sources.
          </p>
        </div>
        {/* Always-visible auditor badge — same source of truth as the
            session-start chooser. Mid-session changes propagate to the
            snapshot via getSessionInstructor (most-recent-wins). */}
        <div className="shrink-0 flex items-center gap-2 text-xs">
          {editingInstructor ? (
            <>
              <label htmlFor="badge-instructor" className="font-mono-plex text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Instructor:</label>
              <select
                id="badge-instructor"
                value={chooserInstructor}
                onChange={e => onInstructorChange(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs"
              >
                {FACULTY_ROSTER.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setEditingInstructor(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <span className="font-mono-plex text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Instructor:</span>
              <span className="font-medium">{chooserInstructor}</span>
              <button
                type="button"
                onClick={() => setEditingInstructor(true)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                title="Change instructor — earlier turns keep their original tag; new turns and the snapshot use the new one."
              >
                change
              </button>
            </>
          )}
        </div>
      </div>

      {chooserMode !== 'fresh' && priorBriefings && priorBriefings.length > 0 && (
        <details className="mb-3 rounded border border-stone-200 bg-stone-50 text-sm">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium text-stone-700">
            Where we left off · {priorBriefings.length} prior session{priorBriefings.length > 1 ? 's' : ''}
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {priorBriefings.map(b => (
              <div key={b.sessionId} className="border-t border-stone-200 pt-2 first:border-t-0 first:pt-0">
                <div className="text-xs text-stone-500">
                  {/* startedAt is UTC ISO; render in the browser's local timezone so the date isn't off-by-one. */}
                  {new Date(b.startedAt).toLocaleDateString()} · {b.turnCount} turns · readiness {b.readiness.score ?? '?'}%
                </div>
                {(b.readiness.covered.length > 0 || b.readiness.remaining.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.readiness.covered.map((c, i) => (
                      <span key={`c-${i}`} className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">{c}</span>
                    ))}
                    {b.readiness.remaining.map((c, i) => (
                      <span key={`r-${i}`} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{c}</span>
                    ))}
                  </div>
                )}
                {b.stickyFindings.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-stone-700">
                    {b.stickyFindings.map((f, i) => (
                      <li key={i}>{f.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div
        ref={transcriptRef}
        className="max-h-[55vh] min-h-[280px] overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <p className="text-sm font-medium">Start the interview when you&apos;re ready.</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              The interviewer opens with what it found in the materials and its first question.
              The conversation runs as long as it needs to ground every rating in evidence —
              you can steer it any time.
            </p>

            <p className="mt-3 text-xs text-muted-foreground">
              Pick who&apos;s interviewing (and build-on vs. fresh) in the panel above, then:
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-3 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start the interview'}
            </button>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'rounded-lg bg-primary/10 px-3 py-2 ml-12'
                  : 'rounded-lg bg-muted/40 px-3 py-2 mr-12'
              }
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {m.role === 'user' ? 'You' : 'Interviewer'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
              {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.citations.map((c, ci) => (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => setDrawerTarget({
                        type: c.type,
                        chunkId: c.chunkId ?? null,
                        messageId: c.messageId ?? null,
                        excerpt: c.excerpt,
                      })}
                      title={c.excerpt}
                      className="inline-flex max-w-full items-center gap-1.5 rounded border bg-background px-1.5 py-0.5 text-[10.5px] font-mono leading-none text-muted-foreground hover:bg-muted"
                    >
                      <span className={'font-semibold ' + (c.type === 'chunk' ? 'text-teal-700' : 'text-amber-700')}>
                        {c.type === 'chunk' ? 'CH' : 'IN'}
                      </span>
                      <span className="max-w-[280px] truncate">{c.excerpt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {busy && messages.length > 0 && messages[messages.length - 1]?.content === '' && (
          <p className="text-xs italic text-muted-foreground">Interviewer is thinking…</p>
        )}
      </div>

      {readiness && (
        <ReadinessStrip
          readiness={readiness}
          peakScore={peakScore}
          coveredEver={coveredEver}
        />
      )}

      {messages.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              // Enter sends; Shift+Enter inserts a newline (standard chat
              // convention). IME composition events are skipped so plain
              // Enter doesn't fire mid-character on languages that need it.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={3}
            placeholder="Type a reply, or use voice. Enter to send, Shift+Enter for a new line."
            className="w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-3">
            <VoiceRecorder slug={slug} onTranscript={appendTranscript} disabled={busy} />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || busy}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* "I'm done" → generate. Pulled out of the Record/Send row and placed
              full-width below the whole input area so it reads as finishing the
              interview, not as another per-message action. */}
          <div className="mt-1 border-t pt-3">
            <button
              type="button"
              onClick={handleOneLastQuestion}
              disabled={!canGenerate || busy}
              className="mb-2 w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              title="Let the interviewer review what's been covered and ask one final, high-value question before you finish."
            >
              Ask me one more important question
            </button>
            <button
              type="button"
              onClick={handleGenerateClick}
              disabled={!canGenerate || busy}
              className={
                'w-full rounded-md border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed '
                + (readiness?.good_enough_to_generate
                  ? 'border-green-400 bg-green-50 text-green-800 hover:bg-green-100'
                  : (readiness?.score ?? 0) >= 50
                  ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-input bg-background hover:bg-muted')
              }
              title={
                !canGenerate
                  ? 'Send at least one reply first'
                  : readiness?.good_enough_to_generate
                  ? `Interviewer reports ${readiness.score}% readiness — ready to generate.`
                  : readiness
                  ? `Interviewer reports ${readiness.score}% readiness — you can still generate, but more questions would tighten the profile.`
                  : 'Generate the Course Outcome Profile from the current conversation'
              }
            >
              I&rsquo;m done — Generate Profile
            </button>
          </div>
        </div>
      )}
      <CitationDrawer
        courseCode={courseCode}
        slug={slug}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />
    </section>
  );
}
