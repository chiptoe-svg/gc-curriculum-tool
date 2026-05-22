# Conversational KUD Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot KUD generation button with a multi-turn chat interface that lets faculty clarify course details with the AI before generating KUDs; Phase 2 routes both this conversation and the materials analysis through a nanoclaw agent with custom tools.

**Architecture (Phase 1):** Client owns the message history array; each send POSTs full history to a stateless chat endpoint that calls Anthropic Messages API and returns a text reply. When faculty click "Generate KUDs", the full conversation history is passed as context to the existing structured-output endpoint, which extracts the KUD JSON. No DB changes needed for Phase 1 (conversation is ephemeral).

**Architecture (Phase 2):** The chat endpoint is swapped to call a nanoclaw agent instead of direct Anthropic. Custom tools (HTTP callbacks) give the agent read access to course materials, profile, and existing KUDs. The materials analysis pipeline is similarly delegated. The UI and KUD persistence layer are unchanged.

**Tech Stack:** Next.js 15 App Router, Anthropic SDK (`@anthropic-ai/sdk`), Zod, React `useState`, existing `loadPrompt` / `getProvider` / `courseKudResultSchema` infrastructure.

---

## Phase 1 — Conversational Chat with Direct Anthropic

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/ai/prompts/kud-chat.md` | System prompt for KUD conversation |
| Create | `lib/ai/analyze/kud-chat.ts` | Multi-turn chat helper (returns text reply) |
| Create | `app/api/courses/[code]/kuds/chat/route.ts` | Chat turn endpoint |
| Create | `app/api/courses/[code]/kuds/chat/__tests__/route.test.ts` | Route tests |
| Modify | `app/api/courses/[code]/kuds/generate/route.ts` | Accept `conversationHistory` in body |
| Modify | `lib/ai/prompts/load.ts` | Add `'kud-chat'` to `PromptName` |
| Modify | `app/preview/[slug]/courses/[code]/KudReviewTab.tsx` | Replace notes+button with chat UI |

---

### Task 1: KUD chat system prompt

**Files:**
- Create: `lib/ai/prompts/kud-chat.md`

- [ ] **Step 1: Create the prompt file**

```markdown
---
name: kud-chat
includes:
  - shared/kud-rubric.md
---

# Role

You are an expert curriculum designer helping a faculty member develop KUD (Know / Understand / Do) learning outcomes for their course. You have been given the course's catalog profile. Your job is to ask targeted clarifying questions before generating KUDs — not to generate them yet.

# What you need to uncover

The KUD rubric (above) defines three levels: Know (recall), Understand (explain / apply in familiar contexts), Do (perform in a new context with practitioner-level criteria). Before KUDs can be drafted accurately, you need to understand what students actually do — not just what the syllabus says they will do.

Probe these areas systematically, 2–3 questions per turn:

1. **Assignments and grading** — What are the highest-stakes assignments? How is each graded? Is the rubric criterion-referenced or holistic? What does a top score look like vs. a passing score?
2. **Major projects** — What does the deliverable actually look like (report, prototype, live demo, presentation)? What decisions does the student make independently? What is provided vs. what must they generate?
3. **Bloom's level check** — For each major assignment, which Bloom's verb most accurately describes what students do: *remember, understand, apply, analyze, evaluate, or create*? Probe specifically — "Apply" covers a wide range.
4. **Threshold concept** — What is the one conceptual shift that separates students who truly get this course from those who memorized it? What do students consistently misunderstand before the shift happens?
5. **Prior knowledge reality** — What do students actually arrive knowing (not what the prereq list says)? What do you routinely re-teach because it wasn't retained?
6. **Transferability** — If a student took this course and never took another one in this department, what could they do in a job or graduate program because of this course specifically?

# Behavior rules

- Ask 2–3 questions per turn. Never more than 3.
- Do NOT generate KUDs or K/U/D bullets during the conversation. That happens when the faculty member clicks "Generate KUDs."
- Acknowledge each answer briefly (1 sentence) before asking the next questions.
- If an answer is vague ("students do a project"), push back once with a specific follow-up ("What does the deliverable look like — a report, a working prototype, a presentation?").
- Reference Bloom's taxonomy levels explicitly when probing assignment depth.
- When you have enough information to generate strong KUDs (typically 3–5 turns), say: "I think I have what I need. You can click **Generate KUDs** when ready, or keep going if there's more to share."

# Opening message

When the conversation starts, briefly acknowledge the course profile you've been given (title, any notable projects), then ask your first 2–3 questions. Lead with the highest-stakes assignment.
```

- [ ] **Step 2: Verify the shared kud-rubric.md include path is correct**

```bash
ls lib/ai/prompts/shared/kud-rubric.md
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/kud-chat.md
git commit -m "feat(kud): add conversational KUD chat system prompt"
```

---

### Task 2: Add `'kud-chat'` to `PromptName` and write the chat helper

**Files:**
- Modify: `lib/ai/prompts/load.ts` (line ~7, the `PromptName` union)
- Create: `lib/ai/analyze/kud-chat.ts`

- [ ] **Step 1: Write a failing test**

Create `lib/ai/analyze/__tests__/kud-chat.test.ts`:

```typescript
import { buildKudChatUserMessage } from '../kud-chat';

describe('buildKudChatUserMessage', () => {
  it('includes course title and profile fields', () => {
    const msg = buildKudChatUserMessage({
      title: 'Data Structures',
      description: 'Algorithms and data organization.',
      learningObjectives: ['Implement linked lists'],
      majorProjects: ['Final sorting benchmark'],
      skillsRequired: ['Python basics'],
    });
    expect(msg).toContain('Data Structures');
    expect(msg).toContain('Final sorting benchmark');
    expect(msg).toContain('Implement linked lists');
  });

  it('handles empty arrays gracefully', () => {
    const msg = buildKudChatUserMessage({
      title: 'New Course',
      description: '',
      learningObjectives: [],
      majorProjects: [],
      skillsRequired: [],
    });
    expect(msg).toContain('(none)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest lib/ai/analyze/__tests__/kud-chat.test.ts --no-coverage
```
Expected: FAIL — `buildKudChatUserMessage` not found.

- [ ] **Step 3: Add `'kud-chat'` to PromptName in `lib/ai/prompts/load.ts`**

Find the `PromptName` type (currently ends at `'parse-profile-fields'`) and add:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target'
  | 'analyze-material'
  | 'synthesize-course-profile'
  | 'draft-course-outcomes'
  | 'extract-course-prereqs'
  | 'score-prior-coverage'
  | 'analyze-course-gaps'
  | 'evaluate-course-scaffolding'
  | 'extract-course-kud'
  | 'parse-profile-fields'
  | 'kud-chat';       // ← add this
```

- [ ] **Step 4: Create `lib/ai/analyze/kud-chat.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt } from '@/lib/ai/prompts/load';

export interface KudChatProfile {
  title: string;
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildKudChatUserMessage(profile: KudChatProfile): string {
  const objLines = profile.learningObjectives.length > 0
    ? profile.learningObjectives.map((o, i) => `${i + 1}. ${o}`)
    : ['(none)'];
  const projLines = profile.majorProjects.length > 0
    ? profile.majorProjects.map((p, i) => `${i + 1}. ${p}`)
    : ['(none)'];
  const skillLines = profile.skillsRequired.length > 0
    ? profile.skillsRequired.map((s, i) => `${i + 1}. ${s}`)
    : ['(none)'];

  return [
    `**Course:** ${profile.title}`,
    `**Description:** ${profile.description || '(none)'}`,
    '',
    '**Learning objectives:**',
    ...objLines,
    '',
    '**Major projects:**',
    ...projLines,
    '',
    '**Required incoming skills:**',
    ...skillLines,
  ].join('\n');
}

export async function kudChatTurn(
  profile: KudChatProfile,
  history: ChatMessage[],
): Promise<string> {
  const systemPrompt = await loadPrompt('kud-chat');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

  // First turn: user message is the course profile. Subsequent turns append to history.
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
    history.length === 0
      ? [{ role: 'user', content: buildKudChatUserMessage(profile) }]
      : history.map(m => ({ role: m.role, content: m.content }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in chat response');
  return textBlock.text;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest lib/ai/analyze/__tests__/kud-chat.test.ts --no-coverage
```
Expected: PASS (only `buildKudChatUserMessage` is tested; `kudChatTurn` hits network so not unit-tested here).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/prompts/load.ts lib/ai/analyze/kud-chat.ts lib/ai/analyze/__tests__/kud-chat.test.ts
git commit -m "feat(kud): add kud-chat prompt name and chat turn helper"
```

---

### Task 3: Chat API route

**Files:**
- Create: `app/api/courses/[code]/kuds/chat/route.ts`
- Create: `app/api/courses/[code]/kuds/chat/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/courses/[code]/kuds/chat/__tests__/route.test.ts`:

```typescript
import { POST } from '../route';
import { isValidSlug } from '@/lib/slug';

jest.mock('@/lib/slug', () => ({ isValidSlug: jest.fn() }));
jest.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: jest.fn(),
}));
jest.mock('@/lib/ai/analyze/kud-chat', () => ({
  kudChatTurn: jest.fn(),
}));
jest.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));
jest.mock('@/lib/ip-hash', () => ({ hashIp: jest.fn().mockReturnValue('testhash') }));

import { getCourseByCode } from '@/lib/db/courses-queries';
import { kudChatTurn } from '@/lib/ai/analyze/kud-chat';

const COURSE = {
  code: 'GC3460', title: 'Data Viz', level: 3, track: 'GC',
  description: 'A course', learningObjectives: [], majorProjects: [], skillsRequired: [],
};

function makeReq(body: object, slug = 'testslug') {
  return new Request(`http://localhost/api/courses/GC3460/kuds/chat?slug=${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  (isValidSlug as jest.Mock).mockReturnValue(true);
  (getCourseByCode as jest.Mock).mockResolvedValue(COURSE);
  (kudChatTurn as jest.Mock).mockResolvedValue('Here are my questions...');
});

it('returns 401 for invalid slug', async () => {
  (isValidSlug as jest.Mock).mockReturnValue(false);
  const res = await POST(makeReq({ messages: [] }), { params: Promise.resolve({ code: 'GC3460' }) });
  expect(res.status).toBe(401);
});

it('returns 404 for unknown course', async () => {
  (getCourseByCode as jest.Mock).mockResolvedValue(null);
  const res = await POST(makeReq({ messages: [] }), { params: Promise.resolve({ code: 'UNKNOWN' }) });
  expect(res.status).toBe(404);
});

it('returns 400 if messages is not an array', async () => {
  const res = await POST(makeReq({ messages: 'bad' }), { params: Promise.resolve({ code: 'GC3460' }) });
  expect(res.status).toBe(400);
});

it('returns reply text on valid request', async () => {
  const res = await POST(makeReq({ messages: [] }), { params: Promise.resolve({ code: 'GC3460' }) });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.reply).toBe('Here are my questions...');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest app/api/courses/\\[code\\]/kuds/chat/__tests__/route.test.ts --no-coverage
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the route**

Create `app/api/courses/[code]/kuds/chat/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { kudChatTurn, type ChatMessage } from '@/lib/ai/analyze/kud-chat';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  }

  const history = (body.messages as Array<Record<string, unknown>>)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

  try {
    const reply = await kudChatTurn(
      {
        title: course.title,
        description: course.description ?? '',
        learningObjectives: (course.learningObjectives as string[]) ?? [],
        majorProjects: (course.majorProjects as string[]) ?? [],
        skillsRequired: (course.skillsRequired as string[]) ?? [],
      },
      history as ChatMessage[],
    );
    return NextResponse.json({ reply });
  } catch (err) {
    console.error(`POST /api/courses/${courseCode}/kuds/chat failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest app/api/courses/\\[code\\]/kuds/chat/__tests__/route.test.ts --no-coverage
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/courses/\[code\]/kuds/chat/
git commit -m "feat(kud): add /kuds/chat endpoint for multi-turn conversation"
```

---

### Task 4: Thread conversation history into the generate endpoint

The generate endpoint currently ignores any prior conversation. When faculty click "Generate KUDs" after a conversation, the full exchange should be passed as context.

**Files:**
- Modify: `app/api/courses/[code]/kuds/generate/route.ts`
- Modify: `lib/ai/analyze/kud-generate.ts`

- [ ] **Step 1: Update `GenerateCourseKudArgs` in `lib/ai/analyze/kud-generate.ts`**

Add `conversationContext?: string` to the interface and include it in `formatInput`:

```typescript
export interface GenerateCourseKudArgs {
  title: string;
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
  notes?: string;
  conversationContext?: string;   // ← add
}
```

In `formatInput`, after the notes block:

```typescript
  if (args.conversationContext?.trim()) {
    parts.push('', '**Conversation with instructor (use this to inform KUD generation):**', args.conversationContext.trim());
  }
```

- [ ] **Step 2: Update the generate route to extract conversation history from body**

In `app/api/courses/[code]/kuds/generate/route.ts`, after the `notes` extraction:

```typescript
  const rawHistory = Array.isArray(body.conversationHistory)
    ? (body.conversationHistory as Array<Record<string, unknown>>)
    : [];
  const conversationContext = rawHistory
    .filter(m => typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => `${String(m.role) === 'assistant' ? 'AI' : 'Instructor'}: ${String(m.content)}`)
    .join('\n\n');
```

Pass it to `generateCourseKud`:

```typescript
    const { data, telemetry } = await generateCourseKud({
      title: course.title,
      description: course.description,
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
      notes,
      conversationContext: conversationContext || undefined,
    });
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/analyze/kud-generate.ts app/api/courses/\[code\]/kuds/generate/route.ts
git commit -m "feat(kud): thread conversation history into structured KUD extraction"
```

---

### Task 5: KudReviewTab — chat UI

Replace the existing notes textarea + Regenerate button with a chat panel. The current direct-edit panel (BulletList textareas) and Accept button remain unchanged after KUDs are generated.

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/KudReviewTab.tsx`

- [ ] **Step 1: Replace state and remove old notes/generate button**

Replace:
```typescript
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
```
With:
```typescript
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
```

Add `useRef` to the React import at the top.

- [ ] **Step 2: Add `handleStartChat` and `handleSend` functions**

Replace the old `handleGenerate` (which sent the one-shot request) with two functions:

```typescript
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
```

Also add a scroll-to-bottom effect:

```typescript
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
```

- [ ] **Step 3: Replace the generate button section in the JSX**

Remove the old notes textarea + generate button block. Replace with:

```tsx
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
```

- [ ] **Step 4: Update `canAccept` — remove the `!dirty` check from the "Start conversation" button area (it remains on the Accept button)**

No change needed — `canAccept` logic is unchanged.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/preview/\[slug\]/courses/\[code\]/KudReviewTab.tsx
git commit -m "feat(kud): replace one-shot generation with conversational chat UI"
```

---

## Phase 2 — Nanoclaw Agent Integration

> **Note:** Phase 2 requires the nanoclaw HTTP API contract before Task 1 can be fully specified. The structure below is complete except where the nanoclaw API shape is noted as TBD. Fill in those details once the API contract is known.

**Goal:** Swap the chat endpoint's direct Anthropic call for a nanoclaw agent, and route materials analysis through the same agent infrastructure. The UI is unchanged.

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/ai/nanoclaw-client.ts` | HTTP client for nanoclaw API |
| Create | `app/api/nanoclaw-tools/get-course-profile/route.ts` | Tool callback: course profile |
| Create | `app/api/nanoclaw-tools/get-course-materials/route.ts` | Tool callback: extracted text |
| Create | `app/api/nanoclaw-tools/get-course-kuds/route.ts` | Tool callback: existing KUDs |
| Create | `app/api/nanoclaw-tools/search-materials/route.ts` | Tool callback: text search |
| Modify | `app/api/courses/[code]/kuds/chat/route.ts` | Swap `kudChatTurn` → nanoclaw |
| Modify | `app/api/courses/[code]/profile/analyze/route.ts` | Swap direct AI calls → nanoclaw |

---

### Task 6: Nanoclaw HTTP client

**Files:**
- Create: `lib/ai/nanoclaw-client.ts`

This wraps the nanoclaw agent API. Fill in the base URL, auth header name, and request/response shape from the nanoclaw API contract.

- [ ] **Step 1: Write failing test**

Create `lib/ai/__tests__/nanoclaw-client.test.ts`:

```typescript
import { nanoclawChat } from '../nanoclaw-client';

global.fetch = jest.fn();

it('posts messages and returns reply text', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ reply: 'Agent response here' }),  // adjust to actual response shape
  });

  const reply = await nanoclawChat({
    agentId: 'kud-agent',
    messages: [{ role: 'user', content: 'Hello' }],
  });

  expect(reply).toBe('Agent response here');
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('kud-agent'),
    expect.objectContaining({ method: 'POST' }),
  );
});

it('throws on non-ok response', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ error: 'server error' }),
  });
  await expect(nanoclawChat({ agentId: 'kud-agent', messages: [] })).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest lib/ai/__tests__/nanoclaw-client.test.ts --no-coverage
```

- [ ] **Step 3: Create `lib/ai/nanoclaw-client.ts`**

```typescript
// TBD: fill in NANOCLAW_BASE_URL, auth header, and response shape from API contract.
const BASE_URL = process.env.NANOCLAW_BASE_URL ?? 'http://localhost:PORT';

export interface NanoclawMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NanoclawChatArgs {
  agentId: string;
  messages: NanoclawMessage[];
  systemContext?: string;
}

export async function nanoclawChat({ agentId, messages, systemContext }: NanoclawChatArgs): Promise<string> {
  const res = await fetch(`${BASE_URL}/agents/${agentId}/chat`, {  // TBD: actual endpoint path
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // TBD: auth header (e.g. 'x-api-key': process.env.NANOCLAW_API_KEY ?? '')
    },
    body: JSON.stringify({ messages, systemContext }),  // TBD: actual body shape
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `nanoclaw ${res.status}`);
  }

  const json = await res.json() as { reply: string };  // TBD: actual response shape
  return json.reply;
}
```

- [ ] **Step 4: Add env var to `.env.local` (do not commit)**

```
NANOCLAW_BASE_URL=http://localhost:PORT
NANOCLAW_API_KEY=your-key-here
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest lib/ai/__tests__/nanoclaw-client.test.ts --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add lib/ai/nanoclaw-client.ts lib/ai/__tests__/nanoclaw-client.test.ts
git commit -m "feat(nanoclaw): add nanoclaw HTTP client"
```

---

### Task 7: Tool callback endpoints

Each tool is an HTTP endpoint the nanoclaw agent calls during conversation. Auth is via the same `slug` validation used everywhere else.

**Files:**
- Create: `app/api/nanoclaw-tools/get-course-profile/route.ts`
- Create: `app/api/nanoclaw-tools/get-course-materials/route.ts`
- Create: `app/api/nanoclaw-tools/get-course-kuds/route.ts`
- Create: `app/api/nanoclaw-tools/search-materials/route.ts`

- [ ] **Step 1: Create `app/api/nanoclaw-tools/get-course-profile/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    code: course.code,
    title: course.title,
    description: course.description,
    learningObjectives: course.learningObjectives,
    majorProjects: course.majorProjects,
    skillsRequired: course.skillsRequired,
  });
}
```

- [ ] **Step 2: Create `app/api/nanoclaw-tools/get-course-materials/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getExtractedTexts } from '@/lib/db/course-materials-queries';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  // Returns fileName + extractedText for each ok material
  const materials = await getMaterialsByCourse(code);
  const okMaterials = materials.filter(m => m.extractionStatus === 'ok');

  return NextResponse.json({
    materials: okMaterials.map(m => ({
      fileName: m.fileName,
      text: m.extractedText ?? '',
    })),
  });
}
```

> **Note:** `getMaterialsByCourse` must include `extractedText`. Check `lib/db/course-materials-queries.ts` — if `extractedText` is not currently selected, add it to the query. Do not add a new query function; extend the existing one.

- [ ] **Step 3: Create `app/api/nanoclaw-tools/get-course-kuds/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseKud } from '@/lib/db/course-kud-queries';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const kud = await getCourseKud(code);
  if (!kud) return NextResponse.json({ kud: null });

  return NextResponse.json({
    kud: {
      thresholdConcept: kud.thresholdConcept,
      know: kud.know,
      understand: kud.understand,
      do: kud.do,
    },
  });
}
```

- [ ] **Step 4: Create `app/api/nanoclaw-tools/search-materials/route.ts`**

Simple case-insensitive text search across all extracted material text for a course.

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getMaterialsByCourse } from '@/lib/db/course-materials-queries';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const query = url.searchParams.get('q') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  if (!query.trim()) return NextResponse.json({ matches: [] });

  const materials = await getMaterialsByCourse(code);
  const lower = query.toLowerCase();

  const matches: Array<{ fileName: string; excerpt: string }> = [];
  for (const m of materials) {
    if (m.extractionStatus !== 'ok' || !m.extractedText) continue;
    const idx = m.extractedText.toLowerCase().indexOf(lower);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 150);
    const end = Math.min(m.extractedText.length, idx + 300);
    matches.push({ fileName: m.fileName, excerpt: m.extractedText.slice(start, end) });
  }

  return NextResponse.json({ matches });
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/api/nanoclaw-tools/
git commit -m "feat(nanoclaw): add tool callback endpoints for course profile, materials, KUDs, search"
```

---

### Task 8: Register tools with nanoclaw and swap the chat endpoint

> **TBD:** Exact registration steps depend on the nanoclaw API. The steps below use a placeholder pattern — update URLs and request shape to match the actual API.

**Files:**
- Modify: `app/api/courses/[code]/kuds/chat/route.ts`

- [ ] **Step 1: Register the four tools with nanoclaw** (one-time setup, done via the nanoclaw dashboard or config file — TBD)

Tool definitions to register:

```
get_course_profile   → GET https://your-app.vercel.app/api/nanoclaw-tools/get-course-profile?slug={slug}&code={code}
get_course_materials → GET https://your-app.vercel.app/api/nanoclaw-tools/get-course-materials?slug={slug}&code={code}
get_course_kuds      → GET https://your-app.vercel.app/api/nanoclaw-tools/get-course-kuds?slug={slug}&code={code}
search_materials     → GET https://your-app.vercel.app/api/nanoclaw-tools/search-materials?slug={slug}&code={code}&q={query}
```

- [ ] **Step 2: Replace `kudChatTurn` call in the chat route with `nanoclawChat`**

In `app/api/courses/[code]/kuds/chat/route.ts`, replace the import and call:

```typescript
// Remove: import { kudChatTurn, type ChatMessage } from '@/lib/ai/analyze/kud-chat';
// Add:
import { nanoclawChat } from '@/lib/ai/nanoclaw-client';

// Replace the try block:
    const reply = await nanoclawChat({
      agentId: 'kud-conversation',   // TBD: actual agent ID in nanoclaw
      messages: history,
      systemContext: `Course code: ${courseCode}. Slug: ${slug}.`,  // passed so agent can use tool callbacks
    });
```

- [ ] **Step 3: Verify end-to-end manually**

Start the dev server (`npm run dev`), open a course in the builder, go to the KUD tab, start a conversation. Confirm the nanoclaw agent responds and can look up course data via the tool callbacks.

- [ ] **Step 4: Commit**

```bash
git add app/api/courses/\[code\]/kuds/chat/route.ts
git commit -m "feat(nanoclaw): swap KUD chat endpoint to nanoclaw agent"
```

---

### Task 9: Swap materials analysis to nanoclaw agent

Currently `analyze-material.ts` and `synthesize-course-profile.ts` make two sequential direct Anthropic calls per run. Replace with a single nanoclaw agent call that can pull materials via tools.

**Files:**
- Modify: `app/api/courses/[code]/profile/analyze/route.ts` (or wherever the analysis pipeline is invoked — check the actual route that calls `analyzeMaterial` and `synthesizeCourseProfile`)

- [ ] **Step 1: Find the analysis pipeline route**

```bash
grep -r "analyzeMaterial\|synthesizeCourseProfile" app/api --include="*.ts" -l
```

- [ ] **Step 2: Create a nanoclaw analysis helper**

Create `lib/ai/course-profile/analyze-with-agent.ts`:

```typescript
import { nanoclawChat } from '@/lib/ai/nanoclaw-client';
import type { CourseProfileResult } from './schema';

export async function analyzeWithAgent(courseCode: string, slug: string): Promise<CourseProfileResult> {
  // The agent uses get_course_materials + get_course_profile tools to read what it needs.
  // We send a single user message to kick it off; it does the rest via tools.
  const reply = await nanoclawChat({
    agentId: 'materials-analysis',  // TBD: actual agent ID
    messages: [{ role: 'user', content: `Analyze all materials for course ${courseCode} and produce a course profile.` }],
    systemContext: `Course code: ${courseCode}. Slug: ${slug}.`,
  });

  // TBD: parse structured output from nanoclaw reply
  // If nanoclaw returns JSON directly, parse it. If text, extract with a follow-up structured call.
  return JSON.parse(reply) as CourseProfileResult;
}
```

- [ ] **Step 3: Swap the route to use `analyzeWithAgent`**

In the analysis route, replace the `analyzeMaterial` / `synthesizeCourseProfile` pipeline with:

```typescript
const profileResult = await analyzeWithAgent(courseCode, slug);
```

Persist and return the result using the same existing DB insert / response shape.

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests pass (unit tests for the old helpers still pass since the helpers still exist).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/course-profile/analyze-with-agent.ts app/api/courses/\[code\]/profile/
git commit -m "feat(nanoclaw): route materials analysis through nanoclaw agent"
```

---

## Self-Review

**Spec coverage:**
- ✅ Conversational chat UI replaces one-shot button
- ✅ System prompt asks 2–3 questions/turn, references Bloom's taxonomy, references KUD rubric
- ✅ Generate KUDs button passes full conversation as context
- ✅ Phase 2 nanoclaw client + 4 tool callbacks
- ✅ Phase 2 KUD chat swapped to nanoclaw
- ✅ Phase 2 materials analysis swapped to nanoclaw

**Placeholder scan:** Tasks 8 and 9 have TBD markers where the nanoclaw API contract is unknown. These are clearly marked — fill in when the contract is provided.

**Type consistency:** `ChatMessage` is defined in `kud-chat.ts` and reused in the chat route. `NanoclawMessage` in the client uses the same `role`/`content` shape. `CourseProfileResult` in `analyze-with-agent.ts` matches the existing import from `./schema`.
