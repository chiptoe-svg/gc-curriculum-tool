'use client';

import { useCallback, useState } from 'react';
import type { CaptureProfile, CaptureReadiness, CaptureReviewerStatus } from '@/lib/ai/capture/schema';
import { CaptureChatPanel, type ChatMessage } from './CaptureChatPanel';
import { ProfileReviewPanel } from './ProfileReviewPanel';
import { MaterialsPanel, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { SnapshotHistoryPanel } from './SnapshotHistoryPanel';

interface Props {
  course: CourseCatalogView;
  initialMaterials: CaptureMaterial[];
  slug: string;
  existingProfile: CaptureProfile | null;
  existingReviewerStatus: CaptureReviewerStatus | null;
  initialMessages: ChatMessage[];
  initialReadiness: CaptureReadiness | null;
  savedConversationAt: Date | null;
}

type Stage = 'chat' | 'generating' | 'review';

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
  initialMessages,
  initialReadiness,
  savedConversationAt,
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
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [materials, setMaterials] = useState<CaptureMaterial[]>(initialMaterials);
  // Bumped each time a new snapshot is created so the history panel reloads.
  const [snapshotsRefreshKey, setSnapshotsRefreshKey] = useState(0);

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
      setStage('review');
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

  async function handleSaveReview(edited: CaptureProfile, status: 'confirmed' | 'edited') {
    const res = await fetch(
      `/api/capture/${encodeURIComponent(courseCode)}/scores?slug=${encodeURIComponent(slug)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: edited, status }),
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

  return (
    <div className="space-y-6">
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

      {stage === 'chat' && (
        <>
          {savedConversationAt && initialMessages.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-amber-50 px-4 py-2 text-xs">
              <p className="text-amber-800">
                <span className="font-medium">Resuming saved conversation</span> from{' '}
                {new Date(savedConversationAt).toLocaleString()}.{' '}
                {initialReadiness && <>Auditor readiness was <span className="font-mono">{initialReadiness.score}%</span> when last saved.</>}
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
          <CaptureChatPanel
            courseCode={courseCode}
            slug={slug}
            messages={messages}
            onMessagesChange={setMessages}
            onGenerate={handleGenerate}
            initialReadiness={initialReadiness}
            onConversationChange={handleConversationChange}
          />
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
                Reviewer status: <span className="font-mono">{reviewerStatus ?? 'ai_drafted'}</span>.{' '}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setStage('review')}
                >
                  View it
                </button>{' '}
                or generate a new one once the audit conversation has the evidence it needs.
              </p>
            </div>
          )}
        </>
      )}

      {stage === 'generating' && (
        <div className="rounded-md border bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium">Generating depth ratings…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Scoring K/U/D depth on each competency, citing evidence excerpts, and producing audit notes.
          </p>
        </div>
      )}

      {stage === 'review' && profile && (
        <ProfileReviewPanel
          profile={profile}
          reviewerStatus={reviewerStatus ?? 'ai_drafted'}
          telemetry={telemetry}
          onSave={handleSaveReview}
          onResumeChat={() => setStage('chat')}
          courseCode={courseCode}
          slug={slug}
          onSnapshotCreated={handleSnapshotCreated}
        />
      )}
    </div>
  );
}
