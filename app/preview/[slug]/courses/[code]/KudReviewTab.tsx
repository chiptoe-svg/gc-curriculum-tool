'use client';

import { useState, useRef, useEffect } from 'react';
import type { BuilderKud } from './CourseBuilderClient';

interface Props {
  courseCode: string;
  slug: string;
  builderStatus: string;
  currentKud: BuilderKud | null;
  profileSummary: {
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  };
  onStatusChange: (newStatus: string, newKud: BuilderKud | null) => void;
}

function BulletList({
  label,
  bullets,
  editable,
  onChange,
}: {
  label: string;
  bullets: string[];
  editable: boolean;
  onChange?: (bullets: string[]) => void;
}) {
  function update(i: number, val: string) {
    if (!onChange) return;
    const next = [...bullets];
    next[i] = val;
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      {bullets.map((b, i) =>
        editable ? (
          <textarea
            key={i}
            value={b}
            rows={2}
            onChange={(e) => update(i, e.target.value)}
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <p key={i} className="text-sm text-muted-foreground leading-snug">– {b}</p>
        )
      )}
    </div>
  );
}

export function KudReviewTab({ courseCode, slug, builderStatus, currentKud, profileSummary, onStatusChange }: Props) {
  const [draft, setDraft] = useState<BuilderKud | null>(currentKud);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const canAccept = builderStatus === 'kuds_generated' && draft !== null && !dirty;
  const isApproved = builderStatus === 'approved';

  function updateBullets(key: 'know' | 'understand' | 'do', bullets: string[]) {
    if (!draft) return;
    setDraft({ ...draft, [key]: bullets });
    setDirty(true);
  }

  async function handleStartChat() {
    setChatting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/chat?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [] }),
        },
      );
      if (!res.ok) throw new Error('Chat failed to start');
      const { reply } = await res.json() as { reply: string };
      setMessages([{ role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start conversation');
    } finally {
      setChatting(false);
    }
  }

  async function handleSend() {
    const text = chatInput.trim();
    if (!text || chatting) return;
    const userMsg = { role: 'user' as const, content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setChatInput('');
    setChatting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/chat?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: next }),
        },
      );
      if (!res.ok) throw new Error('Send failed');
      const { reply } = await res.json() as { reply: string };
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setChatting(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/generate?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationHistory: messages }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Generation failed');
      }
      const { draft: newDraft } = await res.json() as { runId: string; draft: { thresholdConcept: string; know: string[]; understand: string[]; do: string[]; confidenceNotes: string } };
      const newKud: BuilderKud = {
        thresholdConcept: newDraft.thresholdConcept,
        know: newDraft.know,
        understand: newDraft.understand,
        do: newDraft.do,
        manuallyEdited: false,
        sourceRunId: null,
        approvedAt: null,
      };
      setDraft(newKud);
      setDirty(false);
      onStatusChange('kuds_generated', newKud);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thresholdConcept: draft.thresholdConcept,
            know: draft.know,
            understand: draft.understand,
            do: draft.do,
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');
      setDirty(false);
      onStatusChange(builderStatus, draft);
    } catch {
      setError('Failed to save draft. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/accept?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error('Accept failed');
      const { approvedAt } = await res.json() as { approvedAt: string };
      const accepted = draft ? { ...draft, approvedAt } : null;
      setDraft(accepted);
      onStatusChange('approved', accepted);
    } catch {
      setError('Failed to accept. Try again.');
    } finally {
      setAccepting(false);
    }
  }

  const profileIsEmpty =
    profileSummary.learningObjectives.length === 0 && profileSummary.majorProjects.length === 0;

  return (
    <div className="space-y-6">
      {/* Status / guidance */}
      {isApproved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          KUDs accepted{draft?.approvedAt ? ` on ${new Date(draft.approvedAt).toLocaleDateString()}` : ''}. This course is now selectable in the analysis tools. To revise, generate new KUDs and accept again.
        </div>
      )}
      {builderStatus === 'profile_complete' && !draft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Profile saved. Generate KUDs to continue.
        </div>
      )}
      {dirty && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have unsaved edits. Save the draft before accepting, or regenerate to reset to AI output.
        </div>
      )}
      {profileIsEmpty && (
        <div className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          No profile content yet — go to the Profile tab to add learning objectives and projects first. KUD draft will be weaker without them.
        </div>
      )}

      {/* Chat panel */}
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          KUD Conversation
        </div>

        {messages.length === 0 ? (
          <div className="px-4 py-6 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground max-w-sm">
              The AI will ask clarifying questions about your assignments, projects, and grading before generating KUDs.
            </p>
            <button
              type="button"
              onClick={handleStartChat}
              disabled={chatting}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {chatting ? 'Starting…' : 'Start conversation'}
            </button>
          </div>
        ) : (
          <>
            {/* Message list */}
            <div className="max-h-96 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatting && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground animate-pulse">
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input row */}
            <div className="border-t px-4 py-3 flex gap-2">
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={2}
                placeholder="Reply… (Enter to send, Shift+Enter for newline)"
                disabled={chatting}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!chatInput.trim() || chatting}
                className="self-end rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>

      {/* Generate KUDs — only shown after at least one exchange */}
      {messages.length >= 2 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || chatting}
            className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {generating ? 'Generating…' : draft ? '↻ Regenerate KUDs' : 'Generate KUDs'}
          </button>
          <span className="text-xs text-muted-foreground">
            {draft ? 'Regenerate uses the full conversation as context.' : 'Generates KUDs based on the conversation so far.'}
          </span>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      )}

      {/* 3-panel layout */}
      {draft && (
        <>
          <div className="rounded-lg border overflow-hidden">
            <div className="bg-foreground text-background px-4 py-3 text-xs font-mono uppercase tracking-wider">
              KUD Review — {courseCode}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x">
              {/* Left: profile evidence (read-only) */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Profile evidence</p>
                {profileSummary.majorProjects.length > 0 && (
                  <BulletList label="Major projects" bullets={profileSummary.majorProjects} editable={false} />
                )}
                {profileSummary.skillsRequired.length > 0 && (
                  <BulletList label="Required skills" bullets={profileSummary.skillsRequired} editable={false} />
                )}
                {profileSummary.majorProjects.length === 0 && profileSummary.skillsRequired.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No profile content — add projects and skills in the Profile tab.</p>
                )}
              </div>

              {/* Center: editable KUD bullets */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI-drafted KUD outcomes</p>
                <BulletList label="Know" bullets={draft.know} editable onChange={(b) => updateBullets('know', b)} />
                <BulletList label="Understand" bullets={draft.understand} editable onChange={(b) => updateBullets('understand', b)} />
                <BulletList label="Do" bullets={draft.do} editable onChange={(b) => updateBullets('do', b)} />
              </div>

              {/* Right: threshold concept + confidence */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Threshold concept</p>
                <p className="text-sm italic leading-relaxed">&ldquo;{draft.thresholdConcept}&rdquo;</p>
              </div>
            </div>

            {/* Action row */}
            <div className="bg-muted/50 px-4 py-3 flex items-center gap-3 flex-wrap">
              {dirty && (
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-background/80 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
              )}
              <button
                type="button"
                onClick={handleAccept}
                disabled={!canAccept || accepting}
                title={
                  dirty ? 'Save draft first before accepting' :
                  builderStatus !== 'kuds_generated' ? 'Generate KUDs before accepting' :
                  undefined
                }
                className="ml-auto inline-flex items-center rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {accepting ? 'Accepting…' : isApproved ? '✓ Accepted' : 'Accept these KUDs →'}
              </button>
            </div>
          </div>

          {draft.manuallyEdited && (
            <p className="text-xs text-muted-foreground">
              These KUDs contain manual edits. Consider updating the project descriptions in the Profile tab so future regenerations are more accurate.
            </p>
          )}
        </>
      )}
    </div>
  );
}
