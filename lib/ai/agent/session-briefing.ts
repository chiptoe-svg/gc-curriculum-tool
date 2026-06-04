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
