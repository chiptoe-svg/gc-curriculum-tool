'use client';

import { apiErrorText } from '@/lib/ai/credit-client';
import { readNdjson } from '@/lib/client/read-ndjson';
import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import type { CaptureReadiness } from '@/lib/ai/capture/schema';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';
import { turnParts } from '@/lib/capture/merge-turn-text';
import { assistantTurnMessage } from '@/lib/capture/saved-turn';
import { CitationDrawer, type CitationTarget } from './CitationDrawer';
import { InstructorSelect } from './InstructorSelect';
import { AddFileButton, fileMarkers, type AttachedFile, type AddFileHandle } from './AddFileButton';
import { splitFileMarkers } from '@/lib/ai/agent/interview-controls';
import { InterviewChecklist } from './InterviewChecklist';
import { StageProgress } from './staged/StageProgress';
import { IncomingSkillsCard } from './staged/IncomingSkillsCard';
import type { AuditStagedBlock } from '@/lib/ai/agent/audit-response-schema';
import { REVISION_MODE_COPY, type RevisionMode } from '@/lib/capture/revision-copy';
import { EMPTY_CHECKLIST, nextChecklist, type InterviewChecklist as InterviewChecklistData } from '@/lib/capture/interview-checklist';

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

function ReadinessStrip({
  readiness,
  peakScore,
}: {
  readiness: CaptureReadiness;
  /** Highest score the agent has reported across this session. */
  peakScore: number;
}) {
  const tone =
    readiness.score >= 75 ? 'bg-[#2F6B3A]'
      : readiness.score >= 50 ? 'bg-[#B57600]'
      : 'bg-[#9C97A6]';
  // A meaningful regression — the agent dropped its estimate by ≥15 points
  // from a previous high. Almost always means the catalog changed (faculty
  // edited objectives / skills) and the agent is honestly re-probing the
  // new scope. Surface the prior peak so faculty don't read this as state
  // loss or a bug.
  const regressed = peakScore - readiness.score >= 15;
  return (
    <div className="border-t border-[#E4E2E8] bg-white px-4 py-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-medium text-[#5D5966]">
          Interviewer readiness
        </span>
        <div className="h-2 min-w-[8rem] flex-1 rounded-full bg-[#ECEAF0] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${tone}`}
            style={{ width: `${readiness.score}%` }}
          />
        </div>
        <span className="text-sm font-mono tabular-nums text-[#5D5966]">
          {readiness.score}%
          {regressed && (
            <span
              className="ml-1 text-[#8A5A00]"
              title={`Earlier in this session the agent reported ${peakScore}%. The drop usually means the catalog (objectives, skills) changed and the agent is re-probing — not a state-loss bug. Covered items stay in the checklist beside the chat.`}
            >
              (↓ from {peakScore}% — re-probing)
            </span>
          )}
        </span>
        {readiness.good_enough_to_generate && (
          <span
            className="cap-cue cap-cue-done"
            title="The interviewer reports it has enough evidence to generate a defensible profile."
          >
            ready
          </span>
        )}
      </div>
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
  /** The checklist rebuilt from the interview's stored replies (page.tsx), so
   *  items checked off before a reload stay checked. */
  initialChecklist?: InterviewChecklistData | null;
  /** The interview's server session, owned by CaptureClient so it survives
   *  this panel remounting (Generate → Back to chat) and a reload resumes it.
   *  Null until the first turn starts one. */
  sessionId: string | null;
  onSessionIdChange: (sessionId: string) => void;
  /** Auditor identity — controlled by CaptureClient (single source; shared with the landing hero's chooser + the start request). */
  chooserInstructor: string;
  onInstructorChange: (v: string) => void;
  /** Revision mode (approved course) — controlled by CaptureClient; null until chosen. */
  chooserMode: RevisionMode | null;
  onModeChange?: (v: RevisionMode) => void;
  /** True when the course has an approved snapshot, so a mode must be chosen before starting. */
  modeRequired?: boolean;
  /** Distilled recap of prior sessions for the "Where we left off" card. Empty/omitted hides the card. */
  priorBriefings?: SessionBriefingView[];
  /** A staged interview (plan 2026-11-25): the stage bar replaces the checklist, and Skip and Finish are offered. */
  staged?: boolean;
  /** The staged block of the latest interviewer reply, restored on reload (page.tsx). */
  initialStaged?: AuditStagedBlock | null;
}

/** What the staged interview sends for its Skip button; the server detects a skip from this text. */
const SKIP_MESSAGE = 'Skip this question';

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
  initialChecklist,
  sessionId,
  onSessionIdChange,
  chooserInstructor,
  onInstructorChange,
  chooserMode,
  modeRequired = false,
  priorBriefings,
  staged = false,
  initialStaged = null,
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
  // peakScore tracks the highest score the agent reported. The checklist keeps
  // every item ever checked off (lib/capture/interview-checklist.ts); both reset
  // when the conversation resets (the panel remounts).
  const [peakScore, setPeakScore] = useState<number>(initialReadiness?.score ?? 0);
  const [checklist, setChecklist] = useState<InterviewChecklistData>(
    initialChecklist ?? (initialReadiness ? nextChecklist(EMPTY_CHECKLIST, initialReadiness).checklist : EMPTY_CHECKLIST),
  );
  const [justCovered, setJustCovered] = useState<string[]>([]);
  const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
  // Staged interviews: where the latest reply sits in the six stages, and the skills stage 4 asks about.
  const [stagedBlock, setStagedBlock] = useState<AuditStagedBlock | null>(initialStaged);
  const [incomingSkills, setIncomingSkills] = useState<string[] | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const askingIncoming = staged && stagedBlock?.slotAsked === 'incoming';
  useEffect(() => {
    if (!askingIncoming || incomingSkills !== null || !sessionId) return;
    let cancelled = false;
    void (async () => {
      let skills: string[] = [];
      try {
        const res = await fetch(`/api/capture/${encodeURIComponent(courseCode)}/evidence-map?slug=${encodeURIComponent(slug)}&sessionId=${encodeURIComponent(sessionId)}`);
        const json = res.ok ? await res.json().catch(() => null) : null;
        const found: unknown = json?.map?.assumed_skills;
        if (Array.isArray(found)) {
          skills = [...new Set(found.map(x => (x && typeof x.skill === 'string' ? x.skill.trim() : '')).filter(Boolean))].slice(0, 12);
        }
      } catch { /* no card; the instructor types the answer instead */ }
      if (!cancelled) setIncomingSkills(skills);
    })();
    return () => { cancelled = true; };
  }, [askingIncoming, incomingSkills, sessionId, courseCode, slug]);

  // `next` is the transcript to show; `message` is the instructor's new
  // message (omitted on the opening turn). Only `message` is sent.
  async function postChat(next: ChatMessage[], message?: string, opts?: { finish?: boolean }) {
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
            ...(message !== undefined ? { message } : {}),
            ...(opts?.finish ? { finish: true } : {}),
            ...(sessionId ? { sessionId } : {}),
            instructorName: chooserInstructor,
            // Only "Start over" skips the prior-sessions block. The server
            // stores the mode on the first turn and the stored one wins.
            includePriorSessions: chooserMode !== 'fresh',
            ...(chooserMode ? { revisionMode: chooserMode } : {}),
          }),
        },
      );
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError(apiErrorText(json, `Chat failed (${res.status})`));
        // Drop the optimistic empty assistant turn.
        onMessagesChange(next);
        return;
      }

      type FinalResponse = {
        finding?: string;
        question?: string;
        citations?: ChatMessage['citations'];
        readiness?: CaptureReadiness;
        staged?: AuditStagedBlock;
      };
      let finalResponse: FinalResponse | null = null;

      await readNdjson(res, (ev) => {
        const e = ev as { kind: string } & Record<string, unknown>;
        if (e.kind === 'session' && typeof e.sessionId === 'string') {
          onSessionIdChange(e.sessionId);
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
      const newMessages = [...next, assistantTurnMessage(fr)];
      onMessagesChange(newMessages);
      if (fr.staged) setStagedBlock(fr.staged);
      if (fr.readiness) {
        setReadiness(fr.readiness);
        // Track session-cumulative progress so a per-turn score drop
        // (typical after faculty edits the catalog mid-audit) doesn't
        // erase the coverage history the user can already see.
        setPeakScore(prev => Math.max(prev, fr.readiness!.score));
        const step = nextChecklist(checklist, fr.readiness);
        setChecklist(step.checklist);
        setJustCovered(step.justCovered);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
      onMessagesChange(next);
    } finally {
      setBusy(false);
    }
  }

  // No message signals an "opening turn" to the chat route; the audit agent
  // self-introduces from at-rest context (no fake user message is written to
  // the transcript).
  async function handleStart() {
    await postChat([]);
  }

  async function sendText(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: t }];
    onMessagesChange(next);
    await postChat(next, t);
  }
  const [attached, setAttached] = useState<AttachedFile[]>([]);
  const addFileHandle = useRef<AddFileHandle | null>(null);
  const markable = attached.filter(f => !f.id.startsWith('tmp-'));
  async function handleSend() {
    const text = input.trim();
    const markers = fileMarkers(attached);
    // A file alone is enough to send: the message is then just its marker line(s).
    if ((!text && !markers.length) || busy) return;
    setInput('');
    // Files still uploading have no id yet; they stay and go with the next send.
    // The button owns its chips, so it clears the ones this message carries.
    addFileHandle.current?.clearSent(markable.map(f => f.id));
    await sendText([text, ...markers].filter(Boolean).join('\n'));
  }
  const ONE_LAST_QUESTION = "I think I'm about ready to finish. Before I generate, look back over everything we've covered and ask me the single most important question still missing for an accurate profile. If we haven't explored how students struggle, fail, and revise — productive failure / problem-solving — that's a strong candidate. Ask just one question, in your own words.";
  async function handleOneLastQuestion() {
    await sendText(ONE_LAST_QUESTION);
  }
  // Staged Finish: no message, the server's next turn is the recap.
  async function handleFinish() {
    if (busy) return;
    await postChat(messages, undefined, { finish: true });
  }
  // Staged: once the recap turn is out, the same button generates the profile. Keyed on stage state, not
  // only the last kind: after the recap is answered the next reply is answer_only (or a recap follow_up), and
  // the button must not fall back to Finish (final-review C1).
  const recapDone = staged && stagedBlock != null && (
    stagedBlock.kind === 'recap'
    || stagedBlock.slotAsked === 'recap'
    || (stagedBlock.stageProgress.length > 0 && stagedBlock.stageProgress.every(p => p.status === 'done'))
  );
  const showStageBar = staged && stagedBlock != null;

  function appendTranscript(text: string) {
    if (!text) return;
    setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
  }

  const canGenerate = messages.some(m => m.role === 'assistant');
  // One finish button (owner, 2026-10-07): "I'm done — give me one last
  // question" first; once that canned turn is in the transcript (so it
  // survives a reload), the same spot becomes "Generate Profile".
  const lastQuestionIndex = messages.findIndex(m => m.role === 'user' && m.content === ONE_LAST_QUESTION);
  const lastQuestionAsked = lastQuestionIndex >= 0;
  const lastQuestionAnswered =
    lastQuestionAsked && messages.slice(lastQuestionIndex + 1).some(m => m.role === 'user');
  // The current interviewer turn is the visual focus; older turns stay compact.
  const lastAssistantIndex = messages.map(m => m.role).lastIndexOf('assistant');

  function handleGenerateClick() {
    onGenerate();
  }

  return (
    <section className="cap-card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E4E2E8] px-4 py-3">
        <div className="min-w-0">
          <p className="cap-eyebrow">Interview</p>
          <h2 className="cap-title text-xl">Interview conversation</h2>
          <p className="text-xs text-muted-foreground">
            {staged
              ? "Six short stages, about 15 questions. The interviewer starts from what your materials show and asks only what they can't."
              : <>The interviewer reads everything already in the system and asks clarifying questions about
            prereqs, stated vs. evidenced outcomes, and any contradictions across sources.</>}
          </p>
          {chooserMode && messages.length > 0 && (
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">Revision: </span>
              <span className="font-medium">{REVISION_MODE_COPY[chooserMode].label}</span>
            </p>
          )}
        </div>
        {/* Always-visible auditor badge — same source of truth as the
            session-start chooser. Mid-session changes propagate to the
            snapshot via getSessionInstructor (most-recent-wins). */}
        <div className="shrink-0 flex items-center gap-2 text-xs">
          {editingInstructor ? (
            <>
              <label htmlFor="badge-instructor" className="font-mono-plex text-xs uppercase tracking-[0.16em] text-muted-foreground">Instructor:</label>
              <InstructorSelect
                id="badge-instructor"
                value={chooserInstructor}
                onChange={onInstructorChange}
                className="rounded border border-input bg-background px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => setEditingInstructor(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <span className="font-mono-plex text-xs uppercase tracking-[0.16em] text-muted-foreground">Instructor:</span>
              <span className="font-medium">{chooserInstructor}</span>
              <button
                type="button"
                onClick={() => setEditingInstructor(true)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                title="Change instructor — earlier turns keep their original tag; new turns and the snapshot use the new one."
              >
                change
              </button>
            </>
          )}
        </div>
      </div>

      {chooserMode !== 'fresh' && priorBriefings && priorBriefings.length > 0 && (
        <details className="mx-4 mt-3 rounded-2xl border border-[#E4E2E8] bg-white text-sm">
          <summary className="cursor-pointer select-none px-4 py-2.5 font-medium text-[#1D1B22]">
            Where we left off · {priorBriefings.length} prior session{priorBriefings.length > 1 ? 's' : ''}
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {priorBriefings.map(b => (
              <div key={b.sessionId} className="border-t border-[#E4E2E8] pt-2 first:border-t-0 first:pt-0">
                <div className="text-xs text-[#5D5966]">
                  {/* startedAt is UTC ISO; render in the browser's local timezone so the date isn't off-by-one. */}
                  {new Date(b.startedAt).toLocaleDateString()} · {b.turnCount} turns · readiness {b.readiness.score ?? '?'}%
                </div>
                {(b.readiness.covered.length > 0 || b.readiness.remaining.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.readiness.covered.map((c, i) => (
                      <span key={`c-${i}`} className="rounded-full bg-[#E4F0E6] px-2.5 py-0.5 text-xs text-[#2F6B3A]">{c}</span>
                    ))}
                    {b.readiness.remaining.map((c, i) => (
                      <span key={`r-${i}`} className="rounded-full bg-[#FFF4DB] px-2.5 py-0.5 text-xs text-[#8A5A00]">{c}</span>
                    ))}
                  </div>
                )}
                {b.stickyFindings.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-[#1D1B22]">
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

      {/* Transcript, with the interview checklist beside it once the interview
          has started (below it on narrow screens). */}
      <div className={messages.length > 0 && (!staged || showStageBar) ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_17rem]' : undefined}>
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
              Pick who&apos;s interviewing{modeRequired ? ' and what has changed' : ''} in the panel above, then:
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={busy || chooserInstructor.trim() === '' || (modeRequired && chooserMode === null)}
              className="cap-btn cap-btn-primary mt-3 font-semibold"
            >
              {busy ? 'Starting…' : 'Start the interview'}
            </button>
            {modeRequired && chooserMode === null && (
              <p className="mt-2 text-xs text-muted-foreground">Choose what&apos;s changed above to start.</p>
            )}
            {chooserInstructor.trim() === '' && (
              <p className="mt-2 text-xs text-muted-foreground">Pick an instructor above to start.</p>
            )}
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="ml-6 rounded-2xl rounded-br-md bg-[#ECE6F4] px-4 py-2.5 sm:ml-12">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#522D80]">You</p>
                  {(() => {
                    const { text, files } = splitFileMarkers(m.content);
                    return (
                      <>
                        {text && <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{text}</p>}
                        {files.map(f => (
                          <p key={f.id} className="mt-1 text-sm leading-snug">
                            <span aria-hidden>📎</span> {f.name}{f.readable ? '' : ' (could not be read)'}
                          </p>
                        ))}
                      </>
                    );
                  })()}
                </div>
              );
            }
            // Interviewer turn: finding first, citation chips (quiet) under it,
            // then the follow-up question LAST — on the current turn in its own
            // marked block, so it reads straight into the reply box below.
            const isCurrent = i === lastAssistantIndex;
            const { body, question } = turnParts(m);
            return (
              <div
                key={i}
                className={
                  'mr-6 rounded-2xl rounded-bl-md border border-[#E4E2E8] bg-white sm:mr-12 '
                  + (isCurrent ? 'px-4 py-3' : 'px-4 py-2.5')
                }
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5D5966]">Interviewer</p>
                {body && (
                  <p className={'mt-1 whitespace-pre-wrap text-sm ' + (isCurrent ? 'leading-relaxed' : 'leading-snug')}>
                    {body}
                  </p>
                )}
                {m.citations && m.citations.length > 0 && (
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
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#D9D6DF] bg-white px-2.5 py-0.5 text-xs font-mono leading-tight text-[#5D5966] hover:border-[#B9B4C4] hover:text-[#1D1B22]"
                      >
                        <span className={'font-semibold ' + (c.type === 'chunk' ? 'text-[#522D80]' : 'text-[#8A5A00]')}>
                          {c.type === 'chunk' ? 'CH' : 'IN'}
                        </span>
                        <span className="max-w-[280px] truncate">{c.excerpt}</span>
                      </button>
                    ))}
                  </div>
                )}
                {question && (isCurrent ? (
                  <div
                    data-testid="interviewer-question"
                    className="mt-4 rounded-xl border border-[#E4E2E8] border-l-4 border-l-[#522D80] bg-[#F7F5FA] px-4 py-3"
                  >
                    <p className="cap-eyebrow">Question for you</p>
                    <p className="mt-1 whitespace-pre-wrap text-base font-semibold leading-snug text-[#1D1B22]">
                      {question}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-snug">{question}</p>
                ))}
              </div>
            );
          })
        )}
        {askingIncoming && incomingSkills && incomingSkills.length > 0 && !busy && (
          <IncomingSkillsCard skills={incomingSkills} onSubmit={text => void sendText(text)} disabled={busy} />
        )}
        {busy && messages.length > 0 && messages[messages.length - 1]?.content === '' && (
          <p className="text-xs italic text-muted-foreground">Interviewer is thinking…</p>
        )}
      </div>
      {messages.length > 0 && !staged && (
        <div className="border-t border-[#E4E2E8] bg-[#FAF9FB] px-4 py-3 lg:max-h-[55vh] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <InterviewChecklist checklist={checklist} justCovered={justCovered} updating={busy} />
        </div>
      )}
      {messages.length > 0 && staged && stagedBlock && (
        <div className="border-t border-[#E4E2E8] bg-[#FAF9FB] px-4 py-3 lg:max-h-[55vh] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <StageProgress progress={stagedBlock.stageProgress} questionsAsked={stagedBlock.questionsAsked} cap={stagedBlock.cap} />
        </div>
      )}
      </div>

      {/* Shown whether or not the interview has started: an opening turn that
          fails (e.g. the shared OpenAI credits are used up) leaves no messages,
          so the error can't live inside the reply area. */}
      {error && (
        <div role="alert" className="mx-4 my-3 rounded-2xl bg-[#F9E3E3] px-4 py-3 text-sm text-[#9B2C2C]">
          {error}
        </div>
      )}

      {/* Reading order: interviewer question (end of transcript) → reply box →
          Record/Send → readiness → finish actions. The readiness strip used to
          sit between the question and the reply box; it now sits with the
          finish actions it informs. */}
      {messages.length > 0 && (
        <div className="border-t border-[#E4E2E8] px-4 pt-5 pb-4">
          <label htmlFor="capture-reply" className="block text-sm font-medium text-[#1D1B22]">
            Your reply
          </label>
          <textarea
            id="capture-reply"
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
            className="mt-1.5 w-full resize-y rounded-[10px] border border-[#D9D6DF] bg-white px-3 py-2 text-sm focus:border-[#522D80] focus:outline-none focus:ring-2 focus:ring-[#522D80]/25"
          />
          <div className={'mt-4 flex items-center justify-between gap-3' + (staged ? ' flex-wrap' : '')}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <VoiceRecorder slug={slug} onTranscript={appendTranscript} disabled={busy} />
              <AddFileButton courseCode={courseCode} slug={slug} sessionId={sessionId} disabled={busy} files={attached} onChange={setAttached} handle={addFileHandle} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {staged && stagedBlock && !recapDone && (
                <button type="button" onClick={() => void sendText(SKIP_MESSAGE)} disabled={busy} className="cap-btn">
                  Skip this question
                </button>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={(!input.trim() && fileMarkers(attached).length === 0) || busy}
                className="cap-btn cap-btn-primary"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {readiness && !staged && (
        <ReadinessStrip
          readiness={readiness}
          peakScore={peakScore}
        />
      )}

      {messages.length > 0 && (
        <div className="border-t border-[#E4E2E8] px-4 pt-4 pb-4">
          {/* "I'm done" → generate. Pulled out of the Record/Send row and placed
              full-width below the whole input area so it reads as finishing the
              interview, not as another per-message action. */}
          <div>
            <button
              type="button"
              onClick={staged ? (recapDone ? handleGenerateClick : () => void handleFinish()) : lastQuestionAsked ? handleGenerateClick : handleOneLastQuestion}
              disabled={!canGenerate || busy}
              className={
                'cap-btn w-full min-h-11 font-semibold whitespace-normal '
                + (readiness?.good_enough_to_generate
                  ? 'cap-btn-primary'
                  : (readiness?.score ?? 0) >= 50
                  ? '!border-[#B57600] !bg-[#FFF4DB] !text-[#8A5A00]'
                  : '')
              }
              title={
                !canGenerate
                  ? 'Send at least one reply first'
                  : staged
                  ? recapDone
                    ? 'Generate the Course Outcome Profile from this conversation'
                    : 'The interviewer wraps up with a short recap of what you have said. Then you can generate the profile.'
                  : !lastQuestionAsked
                  ? "The interviewer reviews what's been covered and asks one final, high-value question. Then you can generate the profile."
                  : readiness
                  ? `Interviewer reports ${readiness.score}% readiness. Generate the Course Outcome Profile from this conversation.`
                  : 'Generate the Course Outcome Profile from this conversation'
              }
            >
              {staged
                ? (recapDone ? 'Generate Profile' : 'Finish the interview')
                : lastQuestionAsked ? 'Generate Profile' : <>I&rsquo;m done — give me one last question</>}
            </button>
            {!staged && lastQuestionAsked && !lastQuestionAnswered && (
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Answer the last question above first, then generate the profile.
              </p>
            )}
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
