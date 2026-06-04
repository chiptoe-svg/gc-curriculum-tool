/**
 * Deterministic, verbatim session-continuity briefing for the audit agent.
 * Pure module — NO runtime DB import (type-only imports below are erased).
 * See docs/superpowers/specs/2026-06-04-session-continuity-briefing-design.md
 */
import type { PriorSessionSummary, CaptureMessageCitation } from '@/lib/db/capture-messages-queries';

export interface StoredReadiness {
  score: number | null;
  covered: string[];
  remaining: string[];
}

export interface ParsedAssistantTurn {
  finding: string;
  citations: CaptureMessageCitation[];
  readiness: StoredReadiness | null;
}

export interface BriefingFinding {
  text: string;
  citations: CaptureMessageCitation[];
}

export interface SessionBriefing {
  sessionId: string;
  startedAt: Date;
  turnCount: number;
  readiness: StoredReadiness;
  stickyFindings: BriefingFinding[];
  lastFacultyTurn: string | null;
}

const MAX_FINDINGS = 3;
const FINDING_CHAR_CAP = 600;
const FACULTY_CHAR_CAP = 600;

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function isCitation(v: unknown): v is CaptureMessageCitation {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (c.type === 'chunk' || c.type === 'instructor') && typeof c.excerpt === 'string';
}

function normalizeReadiness(v: unknown): StoredReadiness | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  return {
    score: typeof r.score === 'number' ? r.score : null,
    covered: Array.isArray(r.covered) ? (r.covered as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    remaining: Array.isArray(r.remaining) ? (r.remaining as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  };
}

export function composeSessionBriefing(priorSessions: PriorSessionSummary[]): SessionBriefing[] {
  return priorSessions.map((s): SessionBriefing => {
    const turns = s.assistantTurns;

    // Readiness = the most recent turn that recorded one.
    let readiness: StoredReadiness = { score: null, covered: [], remaining: [] };
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i]!.readiness;
      if (r) { readiness = r; break; }
    }

    // Sticky findings: newest-first, distinct by normalized text, up to MAX_FINDINGS.
    const seen = new Set<string>();
    const stickyFindings: BriefingFinding[] = [];
    for (let i = turns.length - 1; i >= 0 && stickyFindings.length < MAX_FINDINGS; i--) {
      const raw = (turns[i]!.finding ?? '').trim();
      if (!raw) continue;
      const normalized = raw.replace(/\s+/g, ' ');
      const norm = normalized.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      stickyFindings.push({ text: cap(normalized, FINDING_CHAR_CAP), citations: turns[i]!.citations });
    }

    return {
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      turnCount: s.turnCount,
      readiness,
      stickyFindings,
      lastFacultyTurn: s.lastFacultyTurn ? cap(s.lastFacultyTurn.trim().replace(/\s+/g, ' '), FACULTY_CHAR_CAP) : null,
    };
  });
}

function renderCitations(citations: CaptureMessageCitation[]): string {
  if (!citations.length) return '';
  const parts = citations
    .map(c => {
      if (c.chunkId) return `chunk ${c.chunkId.slice(0, 8)}`;
      if (c.messageId) return `msg ${c.messageId.slice(0, 8)}`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return parts.length ? `[cites: ${parts.join(', ')}]` : '';
}

export function renderBriefing(briefings: SessionBriefing[]): string {
  if (briefings.length === 0) {
    return '(none — this is the first audit session for this course)';
  }
  return briefings
    .map(b => {
      const r = b.readiness;
      const readinessLine =
        `Readiness: ${r.score ?? '?'}% · covered: ${r.covered.join(', ') || '(none)'} · remaining: ${r.remaining.join(', ') || '(none)'}`;
      const findingsBlock = b.stickyFindings.length
        ? [
            'Findings carried forward (your prior turns, verbatim):',
            ...b.stickyFindings.map(f => {
              const cites = renderCitations(f.citations);
              return `  • "${f.text}"${cites ? ` ${cites}` : ''}`;
            }),
          ].join('\n')
        : 'Findings carried forward: (none recorded)';
      const facultyLine = b.lastFacultyTurn ? `Faculty last said: "${b.lastFacultyTurn}"` : '';
      return [
        `--- Session ${b.sessionId.slice(0, 8)}… · ${b.startedAt.toISOString().slice(0, 10)} · ${b.turnCount} turns ---`,
        readinessLine,
        findingsBlock,
        facultyLine,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

/**
 * Parse a stored assistant-turn `content` string (a JSON-stringified
 * AuditResponse) into typed fields. Returns null when the content is
 * absent, not JSON, or carries no usable signal.
 */
export function parseAssistantContent(content: string | null): ParsedAssistantTurn | null {
  if (!content || content.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
  const citations = Array.isArray(parsed.citations)
    ? (parsed.citations as unknown[]).filter(isCitation)
    : [];
  const readiness = normalizeReadiness(parsed.readiness);
  if (!finding && citations.length === 0 && !readiness) return null;
  return { finding, citations, readiness };
}
