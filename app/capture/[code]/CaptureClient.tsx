'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CaptureProfile, CaptureReadiness, CaptureReviewerStatus } from '@/lib/ai/capture/schema';
import type { ReconciliationLogEntry } from '@/lib/ai/schemas';
import { CaptureChatPanel, type ChatMessage, type SessionBriefingView } from './CaptureChatPanel';
import { ProfileReviewPanel } from './ProfileReviewPanel';
import { ReconciliationStepper } from './ReconciliationStepper';
import { MaterialsPanel, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { SnapshotHistoryPanel } from './SnapshotHistoryPanel';
import { IngestionCheckIn } from './IngestionCheckIn';
import { CaptureHelpPanel } from './HelpPanel';
import { CanvasImportSummary } from './CanvasImportSummary';
import { CaptureHero } from './CaptureHero';
import { CaptureMaterialsStep } from './CaptureMaterialsStep';
import { TriageStep } from './TriageStep';
import { shouldShowMaterialsStep } from '@/lib/capture/material-display';
import { FACULTY_ROSTER } from '@/lib/faculty';

interface Props {
  course: CourseCatalogView;
  initialMaterials: CaptureMaterial[];
  slug: string;
  existingProfile: CaptureProfile | null;
  existingReviewerStatus: CaptureReviewerStatus | null;
  existingReviewerNote: string | null;
  initialMessages: ChatMessage[];
  initialReadiness: CaptureReadiness | null;
  savedConversationAt: Date | null;
  /** Latest non-retired snapshot's instructor + date, for the session-start chooser's "build on" option. */
  priorSnapshotInfo: { instructorName: string | null; createdAt: string } | null;
  /** Instructor stamped on the in-flight session (resumed audit). Null when no session or no instructor was stamped. */
  initialInstructor: string | null;
  /** Distilled recap of prior sessions for the "Where we left off" card. Empty/omitted hides the card. */
  priorBriefings?: SessionBriefingView[];
  catalogSyncedAt: string | null;
  /** True when a non-retired snapshot exists — gates the OKF download link on the review panel. */
  hasSnapshot?: boolean;
  /** Whether the tiered-ingestion triage flow is enabled. Resolved on the SERVER
   *  (page.tsx) and passed down — process.env.COURSECAPTURE_TRIAGE is not visible
   *  to this client component, so it must arrive as a prop. */
  triageEnabled?: boolean;
  /** True when the viewer is an external scoped tester (not Clemson faculty).
   *  Gates the .imscc cartridge fallback: faculty have a Canvas API token and
   *  don't need it; external testers without one keep it. Resolved on the
   *  SERVER (page.tsx, from the scoped session) and passed down. */
  isExternalTester?: boolean;
}

type Stage = 'chat' | 'generating' | 'reconcile' | 'review';

interface Telemetry {
  costUsdCents: number;
  durationMs: number;
  completionTokens: number;
  uncachedPromptTokens: number;
  cachedTokens: number;
  model: string;
}

export function CaptureClient({
  course: initialCourse,
  initialMaterials,
  slug,
  existingProfile,
  existingReviewerStatus,
  existingReviewerNote,
  initialMessages,
  initialReadiness,
  savedConversationAt,
  priorSnapshotInfo,
  initialInstructor,
  priorBriefings,
  catalogSyncedAt,
  hasSnapshot,
  triageEnabled = false,
  isExternalTester = false,
}: Props) {
  const [course, setCourse] = useState<CourseCatalogView>(initialCourse);
  const courseCode = course.code;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // If a conversation is saved, the user is mid-audit — drop them straight
  // back into the chat even if a prior profile exists. They can navigate
  // to the review pane via the "View previously generated profile" link.
  const [stage, setStage] = useState<Stage>(
    initialMessages.length > 0 || !existingProfile ? 'chat' : 'review',
  );
  const [profile, setProfile] = useState<CaptureProfile | null>(existingProfile);
  const [reviewerStatus, setReviewerStatus] = useState<CaptureReviewerStatus | null>(existingReviewerStatus);
  const [generationError, setGenerationError] = useState<string | null>(null);
  // Live elapsed counter while synthesis runs — the "it's working" signal
  // on the generating card (same pattern as the matrix scorer's counter).
  const [genElapsed, setGenElapsed] = useState(0);
  useEffect(() => {
    if (stage !== 'generating') { setGenElapsed(0); return; }
    const t = setInterval(() => setGenElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [reconciliationLog, setReconciliationLog] = useState<ReconciliationLogEntry[]>([]);
  const [materials, setMaterials] = useState<CaptureMaterial[]>(initialMaterials);
  // Bumped each time a new snapshot is created so the history panel reloads.
  const [snapshotsRefreshKey, setSnapshotsRefreshKey] = useState(0);
  // Session-start chooser state — single source of truth, shared by the landing
  // hero's chooser controls and the chat panel's mid-session auditor badge +
  // start request. Pre-fills from a resumed session's stamped instructor;
  // otherwise starts EMPTY so the picker shows its "Instructor name" placeholder
  // and the user must actively choose (no silent default to the first roster
  // name — that mis-attributed captures to whoever sorted first).
  const [chooserInstructor, setChooserInstructor] = useState<string>(
    initialInstructor && FACULTY_ROSTER.includes(initialInstructor)
      ? initialInstructor
      : '',
  );
  const [chooserMode, setChooserMode] = useState<'fresh' | 'continue'>(
    priorSnapshotInfo ? 'continue' : 'fresh',
  );
  // Wizard sub-step: confirm materials (Step 1) → optional triage (Step 2, flag-gated)
  // → interview (Step 3). Reversible via the interview's "Back to materials" button.
  // A resumed conversation (messages already exist) starts on 'interview' so it
  // lands straight in the chat rather than re-confirming materials first.
  const [landingStep, setLandingStep] = useState<'materials' | 'ingest' | 'interview'>(
    initialMessages.length > 0 ? 'interview' : 'materials',
  );
  // Collapsed "Setup & history" disclosure on the interview step.
  const [setupOpen, setSetupOpen] = useState(false);

  const handleSnapshotCreated = useCallback(() => {
    setSnapshotsRefreshKey(k => k + 1);
  }, []);

  const handleUseSnapshotAsDraft = useCallback(async (snapshotId: string) => {
    const res = await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/snapshots/${snapshotId}/use-as-draft?slug=${encodeURIComponent(slug)}`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? 'Failed to load snapshot as draft');
    }
    // Clear the in-flight conversation — the new draft is the starting state.
    await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/conversation?slug=${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
    ).catch(() => { /* best-effort */ });
    // Reload the page so the draft + cleared conversation are picked up.
    window.location.reload();
  }, [courseCode, slug]);

  // Autosave the running conversation server-side so a closed tab, refresh,
  // or failed Generate doesn't lose progress. Called by the chat panel after
  // every successful turn.
  const handleConversationChange = useCallback(async (
    nextMessages: ChatMessage[],
    nextReadiness: CaptureReadiness | null,
  ) => {
    try {
      await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/conversation?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: nextMessages, readiness: nextReadiness }),
        },
      );
    } catch {
      // Best-effort autosave; the running conversation still lives in client
      // state so the active session isn't broken if the save fails.
    }
  }, [courseCode, slug]);

  const handleClearConversation = useCallback(async () => {
    try {
      await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/conversation?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
    } catch {
      // ignore
    }
    setMessages([]);
  }, [courseCode, slug]);

  const [resetState, setResetState] = useState<'idle' | 'resetting' | 'error'>('idle');
  const [chatPanelKey, setChatPanelKey] = useState(0);
  const handleResetAudit = useCallback(async () => {
    if (
      !window.confirm(
        'Reset this course\'s interview chat?\n\n' +
        'Clears the current working draft. Prior session transcripts, ' +
        'snapshots, and indexed materials are preserved. The agent on the ' +
        'next session will see the prior sessions as continuity context.\n\n' +
        'For a deeper reset (re-ingest materials too), use the curl runbook.',
      )
    ) return;
    setResetState('resetting');
    try {
      const res = await fetch('/api/admin/v2-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode, scope: 'session', slug }),
      });
      if (!res.ok) throw new Error(`v2-reset ${res.status}`);
      // Also drop the legacy v1 conversation row so they stay in sync.
      await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/conversation?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      ).catch(() => {});
      setMessages([]);
      setProfile(null);
      setReviewerStatus(null);
      setStage('chat');
      setChatPanelKey(k => k + 1);
      setResetState('idle');
    } catch (e) {
      console.error('reset failed', e);
      setResetState('error');
    }
  }, [courseCode, slug]);

  async function handleGenerate() {
    setStage('generating');
    setGenerationError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/scores?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setStage('chat');
        setGenerationError((json as { error?: string; detail?: string }).error
          ?? 'Failed to generate Course Outcome Profile');
        return;
      }
      const { profile: newProfile, reviewerStatus: newStatus, telemetry: t } =
        json as { profile: CaptureProfile; reviewerStatus: CaptureReviewerStatus; telemetry?: Telemetry };
      setProfile(newProfile);
      setReviewerStatus(newStatus);
      if (t) setTelemetry(t);
      setStage('reconcile');
      // Generation succeeded — clear the persisted transcript so the next
      // visitor starts fresh. In-memory `messages` is intentionally kept so
      // "Back to chat" works for this session if the reviewer wants to add
      // more context and re-generate.
      void fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/conversation?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      ).catch(() => { /* best-effort */ });
    } catch (e) {
      setStage('chat');
      setGenerationError(e instanceof Error ? e.message : 'Failed to generate Course Outcome Profile');
    }
  }

  const resumeChat = useCallback(() => {
    setReconciliationLog([]);
    setStage('chat');
  }, []);

  async function handleSaveReview(
    edited: CaptureProfile,
    status: 'confirmed' | 'edited',
    reviewerNote: string | null,
  ) {
    const res = await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/scores?slug=${encodeURIComponent(slug)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: edited, status, reviewerNote }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? 'Save failed');
    }
    const { profile: saved, reviewerStatus: savedStatus } =
      await res.json() as { profile: CaptureProfile; reviewerStatus: CaptureReviewerStatus };
    setProfile(saved);
    setReviewerStatus(savedStatus);
  }

  // First-run landing = the audit chat with no conversation yet. There the
  // goal-first hero + the chooser/Start (inside CaptureChatPanel) lead, and the
  // setup trays collapse below. Every other state keeps the trays up top.
  const isLanding = stage === 'chat' && messages.length === 0;
  const showMaterialsStep = shouldShowMaterialsStep({ stage, landingStep });
  const trays = (
    <>
      <CaptureHelpPanel />
      <CanvasImportSummary materials={materials} />
      <MaterialsPanel
        course={course}
        initialMaterials={materials}
        slug={slug}
        onMaterialsChange={setMaterials}
        onCourseChange={setCourse}
      />
      <SnapshotHistoryPanel
        courseCode={courseCode}
        slug={slug}
        onUseAsDraft={handleUseSnapshotAsDraft}
        refreshKey={snapshotsRefreshKey}
      />
    </>
  );

  return (
    <div className="space-y-6">
      {showMaterialsStep ? (
        <CaptureMaterialsStep
          course={course}
          materials={materials}
          slug={slug}
          catalogSyncedAt={catalogSyncedAt}
          onMaterialsChange={setMaterials}
          onCourseChange={setCourse}
          onContinue={() => setLandingStep(triageEnabled ? 'ingest' : 'interview')}
          instructor={chooserInstructor}
          onInstructorChange={setChooserInstructor}
          triageEnabled={triageEnabled}
          showImscc={isExternalTester}
        />
      ) : isLanding && landingStep === 'ingest' ? (
        <TriageStep
          courseCode={courseCode}
          slug={slug}
          materials={materials}
          onIngested={() => setLandingStep('interview')}
        />
      ) : (
        <>
      {stage === 'chat' && (
        <>
          {/* Step 2 wizard header — mirrors Step 1 (CaptureMaterialsStep). "Back
              to materials" flips landingStep back to 'materials'; the conversation
              in state is preserved, so Continue returns to it intact. */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Step 2 of 2 · Interview</span>
              <span aria-hidden>○</span><span aria-hidden>──</span><span aria-hidden className="text-foreground">●</span>
            </div>
            <button
              type="button"
              onClick={() => setLandingStep('materials')}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              ← Back to materials
            </button>
          </div>

          {/* Setup &amp; history — per-interview context (help, Canvas import,
              materials, snapshots) collapsed out of the way, one click away.
              Hidden on the first-run landing where the hero leads. The trays
              mount only when opened (lazy). */}
          {!isLanding && (
            <div className="rounded-lg border bg-card">
              <button
                type="button"
                onClick={() => setSetupOpen(o => !o)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-muted/50"
              >
                <span aria-hidden className={'inline-block text-muted-foreground transition-transform ' + (setupOpen ? '' : '-rotate-90')} style={{ fontSize: '10px', lineHeight: 1 }}>▼</span>
                Setup &amp; history
                <span className="font-normal text-muted-foreground">— materials, Canvas import, snapshots, help</span>
              </button>
              {setupOpen && <div className="space-y-6 border-t p-4">{trays}</div>}
            </div>
          )}

          {isLanding && (
            <CaptureHero
              courseCode={courseCode}
              courseTitle={course.title}
              materialsCount={materials.length}
              instructor={chooserInstructor}
              onInstructorChange={setChooserInstructor}
              mode={chooserMode}
              onModeChange={setChooserMode}
              priorSnapshotInfo={priorSnapshotInfo}
            />
          )}
          {savedConversationAt && initialMessages.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-amber-50 px-4 py-2 text-xs">
              <p className="text-amber-800">
                <span className="font-medium">Resuming saved conversation</span> from{' '}
                {new Date(savedConversationAt).toLocaleString()}.{' '}
                {initialReadiness && <>Interviewer readiness was <span className="font-mono">{initialReadiness.score}%</span> when last saved.</>}
              </p>
              <button
                type="button"
                onClick={handleClearConversation}
                className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
              >
                Start over
              </button>
            </div>
          )}
          <IngestionCheckIn courseCode={courseCode} slug={slug} />
          <CaptureChatPanel
            key={chatPanelKey}
            courseCode={courseCode}
            slug={slug}
            messages={messages}
            onMessagesChange={setMessages}
            onGenerate={handleGenerate}
            initialReadiness={initialReadiness}
            onConversationChange={handleConversationChange}
            chooserInstructor={chooserInstructor}
            onInstructorChange={setChooserInstructor}
            chooserMode={chooserMode}
            onModeChange={setChooserMode}
            priorBriefings={priorBriefings}
          />
          <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
            {resetState === 'error' && (
              <span className="text-destructive">Reset failed — check the server log.</span>
            )}
            <button
              type="button"
              onClick={handleResetAudit}
              disabled={resetState === 'resetting'}
              className="rounded border border-stone-300 bg-white px-2 py-1 font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              title="Clear the working draft for this course and start the interview chat fresh. Prior sessions and indexed materials stay."
            >
              {resetState === 'resetting' ? 'Resetting…' : 'Reset interview'}
            </button>
          </div>
          {generationError && (
            <div className="rounded-md border border-destructive/30 bg-red-50 px-4 py-3 text-sm">
              <p className="font-medium text-destructive">Generation failed: {generationError}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your conversation is saved — you can try again now, or come back later and resume from where you left off.
              </p>
            </div>
          )}
          {profile && (
            <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
              <p className="font-medium">A prior profile exists for this course.</p>
              <p className="mt-1 text-muted-foreground">
                Reviewer status: <span className="font-mono">{
                  ({ ai_drafted: 'in progress', confirmed: 'confirmed', edited: 'edited' } as const)[reviewerStatus ?? 'ai_drafted']
                }</span>.{' '}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setStage('review')}
                >
                  View it
                </button>{' '}
                or generate a new one once the interview conversation has the evidence it needs.
              </p>
            </div>
          )}
          {isLanding && (
            <details className="rounded-md border bg-card text-sm">
              <summary className="cursor-pointer list-none px-4 py-2.5 font-medium text-muted-foreground hover:text-foreground">
                ⚙ Materials, Canvas import, help &amp; snapshot history
              </summary>
              <div className="space-y-6 border-t px-4 py-4">{trays}</div>
            </details>
          )}
        </>
      )}

      {stage === 'generating' && (
        <div className="rounded-md border bg-muted/20 px-6 py-6">
          <div className="mb-4 flex items-center justify-center gap-3">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
            />
            <p className="text-sm font-medium animate-pulse">Generating the Course Outcome Profile… {genElapsed}s</p>
          </div>
          {/* Behind-the-scenes account (2026-06-12 walkthrough request) — what
              the synthesis call is actually doing, in order. Keep faithful to
              generateCaptureProfileV2: transcript+materials bundle → one heavy
              scoring pass → schema/citation validation → editable draft. */}
          <ol className="mx-auto max-w-xl space-y-2 text-xs text-muted-foreground">
            <li><span className="font-medium text-foreground">1 · Gathering the evidence.</span> Your full interview transcript (every answer, with citations) is bundled with the Google-Sheet catalog and the active course materials.</li>
            <li><span className="font-medium text-foreground">2 · Scoring against the depth rubric.</span> One synthesis pass discovers the course&apos;s technical competencies (typically 5–15) and scores each on Know / Understand / Do, 0–5 — plus the five foundational dispositions (Do only).</li>
            <li><span className="font-medium text-foreground">3 · Enforcing the evidence rules.</span> Any score above the floor must carry an evidence excerpt, and every finding needs a source plus citations that resolve to a real material chunk or interview turn — results that don&apos;t validate are rejected and retried.</li>
            <li><span className="font-medium text-foreground">4 · Filling out the record.</span> Incoming expectations, course emphasis (where the graded points actually go), class structure, major projects, and a verification summary.</li>
            <li><span className="font-medium text-foreground">5 · Returning a draft — not a record.</span> Everything lands as an editable draft for your review. Nothing becomes an immutable snapshot until you confirm it.</li>
          </ol>
          <p className="mt-4 text-center text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Usually 15–60 seconds — please don&apos;t close this tab
          </p>
        </div>
      )}

      {stage === 'reconcile' && profile && (
        <ReconciliationStepper
          profile={profile}
          slug={slug}
          courseCode={courseCode}
          onComplete={async (reconciled, log) => {
            setReconciliationLog(log);
            try {
              // Persist the reconciled profile to the DB draft BEFORE entering
              // review. The snapshots route reads draft.profile directly, so
              // without this the snapshot would store the pre-reconciliation
              // profile even though the reconciliation_log says otherwise.
              // handleSaveReview sets profile+reviewerStatus on success.
              await handleSaveReview(reconciled, 'edited', existingReviewerNote ?? null);
            } catch {
              // If the persist fails, still advance so the user isn't stuck.
              // The review panel's own Save path will re-attempt on the next
              // explicit save.
              setProfile(reconciled);
            }
            setStage('review');
          }}
        />
      )}

      {stage === 'review' && profile && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStage('reconcile')}
              className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-700 hover:bg-stone-50"
            >
              Reconcile with the interviewer
            </button>
          </div>
          <ProfileReviewPanel
            profile={profile}
            reviewerStatus={reviewerStatus ?? 'ai_drafted'}
            initialReviewerNote={existingReviewerNote}
            telemetry={telemetry}
            onSave={handleSaveReview}
            onResumeChat={resumeChat}
            courseCode={courseCode}
            courseTitle={course.title}
            slug={slug}
            onSnapshotCreated={handleSnapshotCreated}
            reconciliationLog={reconciliationLog}
            hasSnapshot={hasSnapshot}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}
