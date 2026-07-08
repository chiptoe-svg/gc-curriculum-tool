'use client';

/**
 * Curriculum-chat panel. Shared across three surfaces:
 *   - Explore "Ask" tab — course-anchored, hits /api/explore/[code]/chat
 *   - /ask standalone — no anchor, hits /api/ask/chat
 *   - /wiki index — no anchor (same as /ask)
 *
 * Local state only — the chat transcript lives in component state and
 * is discarded on unmount / route change. No DB persistence (yet);
 * audit chat is the only persisted surface and that's a separate concern.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import type { CurriculumChatCitation } from '@/lib/ai/wiki/response-schema';
import { ScenarioCard } from '@/app/explore/[code]/ScenarioCard';
import { ComparisonCard } from '@/app/explore/[code]/ComparisonCard';
import type { Scenario } from '@/lib/ai/explore/scenario';
import type { ScenarioComparison } from '@/lib/ai/explore/compare';

/**
 * Strip inline citation markers like [courses/gc-3460.md] from assistant
 * content. The structured `citations` array is rendered separately below the
 * bubble, so these inline path markers are redundant and clutter the prose.
 */
function stripInlineCitations(s: string): string {
  return s.replace(/\s*\[(courses|competencies|targets|concepts)\/[^\]\s]+\.md\]/g, '');
}

interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: CurriculumChatCitation[];
  /** Tool calls the agent made on this turn (for the "tool trail" disclosure). */
  toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>;
  /** Scenario cards streamed inline from the Explore agent. */
  scenarios?: Scenario[];
  /** Comparison cards streamed inline from the Explore agent. */
  comparisons?: Array<{ aCaption: string; bCaption: string; diff: ScenarioComparison }>;
}

interface Props {
  /**
   * When set, the panel header reads "Asking about <courseCode>" and the
   * empty-state suggestions are course-anchored. When undefined, the panel
   * runs in standalone mode (program-level chat).
   */
  courseCode?: string;
  courseTitle?: string;
  slug: string;
  /**
   * Override the chat endpoint. Defaults to /api/explore/[courseCode]/chat
   * when `courseCode` is set, /api/ask/chat otherwise.
   */
  endpoint?: string;
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
        // Ignore malformed lines — server only emits valid JSON per line.
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail)); } catch { /* ignore */ }
  }
}

const COURSE_SUGGESTIONS = [
  'What does this course set up for downstream courses?',
  'Which career targets does this course support best?',
  'What concepts are anchored in this course?',
  'How does this compare to its prerequisites?',
];

const STANDALONE_SUGGESTIONS = [
  'What career paths is the program structured around?',
  'Where in the program do students develop problem-solving?',
  'Which courses are the load-bearing pieces of brand-strategy?',
  'Are there gaps in Act 2 (mid-program integration)?',
];

export function AskTab({ courseCode, courseTitle, slug, endpoint }: Props) {
  const isCourseAnchored = Boolean(courseCode);
  const suggestions = isCourseAnchored ? COURSE_SUGGESTIONS : STANDALONE_SUGGESTIONS;
  const resolvedEndpoint =
    endpoint
    ?? (courseCode
      ? `/api/explore/${encodeURIComponent(courseCode)}/chat?slug=${encodeURIComponent(slug)}`
      : `/api/ask/chat?slug=${encodeURIComponent(slug)}`);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const nextMessages: AskMessage[] = [
      ...messages,
      { role: 'user', content: trimmed },
    ];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);

    // Add a placeholder assistant message we mutate as deltas stream in.
    setMessages(m => [...m, { role: 'assistant', content: '', toolCalls: [] }]);

    try {
      const res = await fetch(resolvedEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
      }

      let assistantText = '';
      const toolCalls: AskMessage['toolCalls'] = [];
      const scenarios: Scenario[] = [];
      const comparisons: Array<{ aCaption: string; bCaption: string; diff: ScenarioComparison }> = [];

      await readNdjson(res, ev => {
        const kind = ev.kind as string | undefined;
        if (kind === 'tool-start') {
          toolCalls!.push({
            toolName: ev.toolName as string,
            args: (ev.args as Record<string, unknown>) ?? {},
          });
          setMessages(m => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), { ...last, toolCalls: [...toolCalls!] }];
          });
        } else if (kind === 'text-delta') {
          // Accumulate deltas internally but don't push raw structured-output
          // JSON to the visible bubble — the `final` event sets the real answer.
          assistantText += (ev.delta as string) ?? '';
        } else if (kind === 'final') {
          const response = ev.response as { response: string; citations: CurriculumChatCitation[] };
          setMessages(m => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), {
              ...last,
              content: response.response,
              citations: response.citations,
            }];
          });
        } else if (kind === 'scenario') {
          scenarios.push(ev.scenario as Scenario);
          setMessages(m => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), { ...last, scenarios: [...scenarios] }];
          });
        } else if (kind === 'comparison') {
          const a = ev.a as Scenario;
          const b = ev.b as Scenario;
          comparisons.push({
            aCaption: (a.caption ?? a.change.activity),
            bCaption: (b.caption ?? b.change.activity),
            diff: ev.diff as ScenarioComparison,
          });
          setMessages(m => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), { ...last, comparisons: [...comparisons] }];
          });
        } else if (kind === 'error') {
          setError((ev.message as string) ?? 'Stream error');
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      // Drop the placeholder assistant message if the request never produced one.
      setMessages(m => {
        const last = m[m.length - 1];
        if (last && last.role === 'assistant' && !last.content) return m.slice(0, -1);
        return m;
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(id: string) {
    const caption = window.prompt('Name this scenario:');
    if (!caption || !courseCode) return;
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/scenarios/${id}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caption }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save scenario');
    }
  }

  function handleCompare(id: string) {
    void send(`Compare scenario ${id} with another saved one for this course — list my saved scenarios first if needed, then compare.`);
  }

  return (
    <section className="flex flex-col rounded-md border bg-card">
      <header className="border-b px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ask · Curriculum chat</p>
        <h3 className="mt-0.5 text-sm font-semibold">
          {isCourseAnchored ? (
            <>
              Asking about {courseCode}
              <span className="ml-2 font-normal text-muted-foreground">— anchored to this course, but you can ask about the whole program.</span>
            </>
          ) : (
            <>
              Asking about the curriculum
              <span className="ml-2 font-normal text-muted-foreground">— program-level questions across courses, competencies, career targets, and concepts.</span>
            </>
          )}
        </h3>
      </header>

      <div
        ref={transcriptRef}
        className="flex-1 max-h-[60vh] overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              {isCourseAnchored
                ? `Ask a question about ${courseTitle}, or anything else in the program. Some starting points:`
                : 'Ask a question about the GC curriculum. Some starting points:'}
            </p>
            <ul className="space-y-1">
              {suggestions.map(s => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="text-left text-xs underline-offset-2 hover:text-foreground hover:underline"
                  >
                    → {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              slug={slug}
              onSave={handleSave}
              onCompare={handleCompare}
            />
          ))
        )}
        {error && (
          <p className="text-xs text-destructive">Error: {error}</p>
        )}
      </div>

      <form
        className="border-t px-4 py-3 flex items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isCourseAnchored ? 'Ask about this course or anything in the program…' : 'Ask about the curriculum…'}
          disabled={busy}
          className="flex-1 rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <VoiceRecorder
          slug={slug}
          disabled={busy}
          onTranscript={text => {
            // Append to the input rather than auto-send — faculty often
            // want to read what was transcribed (and trim filler) before
            // sending. Matches the CaptureChatPanel pattern.
            setInput(prev => (prev ? `${prev} ${text}` : text));
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({
  message,
  slug,
  onSave,
  onCompare,
}: {
  message: AskMessage;
  slug: string;
  onSave: (id: string) => void;
  onCompare: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'pl-4' : ''}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {isUser ? 'You' : 'Assistant'}
      </p>
      <div className="mt-1 leading-snug">
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : message.content ? (
          <div className="ask-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {stripInlineCitations(message.content)}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="text-sm italic text-muted-foreground">Composing…</span>
        )}
      </div>
      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Tools: {message.toolCalls.map(tc => tc.toolName).join(' · ')}
        </p>
      )}
      {!isUser && message.citations && message.citations.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {message.citations.map((c, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              {c.path != null
                ? <WikiLink path={c.path} slug={slug} />
                : <span>{c.courseCode} · {c.fileName}</span>}
              {' '}
              <span className="italic">"{c.excerpt}"</span>
            </li>
          ))}
        </ul>
      )}
      {!isUser && (message.scenarios?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-2" data-testid="scenario-cards">
          {message.scenarios!.map(s => (
            <ScenarioCard key={s.id} scenario={s} onSave={onSave} onCompare={onCompare} />
          ))}
        </div>
      )}
      {!isUser && (message.comparisons?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-2" data-testid="comparison-cards">
          {message.comparisons!.map((c, i) => (
            <ComparisonCard key={i} aCaption={c.aCaption} bCaption={c.bCaption} diff={c.diff} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Convert a wiki path like `courses/gc-4800.md` into a link to the in-app
 * wiki route. Paths follow `{type}/{slug}.md` (or `index.md`). The wiki
 * routes are at `/wiki/[type]/[slug]?slug={accessSlug}`. We don't deep-link
 * to index.md since `/wiki?slug=…` is the route for that.
 */
function WikiLink({ path, slug }: { path: string; slug: string }) {
  if (path === 'index.md') {
    return (
      <Link href={`/wiki?slug=${encodeURIComponent(slug)}`} className="underline hover:text-foreground">
        index
      </Link>
    );
  }
  const m = path.match(/^([^/]+)\/(.+)\.md$/);
  if (!m) return <span>{path}</span>;
  const [, type, pageSlug] = m;
  return (
    <Link
      href={`/wiki/${encodeURIComponent(type!)}/${encodeURIComponent(pageSlug!)}?slug=${encodeURIComponent(slug)}`}
      className="underline hover:text-foreground"
    >
      {type}/{pageSlug}
    </Link>
  );
}
