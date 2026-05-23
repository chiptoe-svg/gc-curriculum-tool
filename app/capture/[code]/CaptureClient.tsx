'use client';

import { useState } from 'react';
import type { CaptureProfile, CaptureReviewerStatus } from '@/lib/ai/capture/schema';
import { CaptureChatPanel, type ChatMessage } from './CaptureChatPanel';
import { ProfileReviewPanel } from './ProfileReviewPanel';
import { MaterialsPanel, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';

interface Props {
  course: CourseCatalogView;
  initialMaterials: CaptureMaterial[];
  slug: string;
  existingProfile: CaptureProfile | null;
  existingReviewerStatus: CaptureReviewerStatus | null;
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

export function CaptureClient({ course: initialCourse, initialMaterials, slug, existingProfile, existingReviewerStatus }: Props) {
  const [course, setCourse] = useState<CourseCatalogView>(initialCourse);
  const courseCode = course.code;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<Stage>(existingProfile ? 'review' : 'chat');
  const [profile, setProfile] = useState<CaptureProfile | null>(existingProfile);
  const [reviewerStatus, setReviewerStatus] = useState<CaptureReviewerStatus | null>(existingReviewerStatus);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [materials, setMaterials] = useState<CaptureMaterial[]>(initialMaterials);

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

      {stage === 'chat' && (
        <>
          <CaptureChatPanel
            courseCode={courseCode}
            slug={slug}
            messages={messages}
            onMessagesChange={setMessages}
            onGenerate={handleGenerate}
          />
          {generationError && (
            <p className="text-sm text-destructive">Generation failed: {generationError}</p>
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
        />
      )}
    </div>
  );
}
