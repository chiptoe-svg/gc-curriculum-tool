// Look at GC 4800 in detail — the one draft with PF populated.
// Did the chat actually probe Audit Area 7, or did the scorer just infer?
// Also: what's the materials shape? Sheets vs Canvas vs Google Workspace vs uploaded.
// Run: set -a; source .env.local; set +a; pnpm tsx scripts/_one-off/inspect-gc4800.ts

import { db } from '@/lib/db/client';
import {
  courseCaptureProfiles,
  captureConversations,
  courseMaterials,
  courses,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const CODE = 'GC 4800';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string }

async function main() {
  const [course] = await db.select().from(courses).where(eq(courses.code, CODE));
  console.log(`=== ${CODE} — ${course?.title ?? ''} ===\n`);

  console.log('Catalog (from Sheets sync):');
  console.log(`  description: ${(course?.description ?? '').slice(0, 200)}${(course?.description?.length ?? 0) > 200 ? '...' : ''}`);
  console.log(`  prerequisites: ${course?.prerequisites ?? '(none)'}`);
  console.log(`  learning_objectives: ${JSON.stringify(course?.learningObjectives ?? [])}`);
  console.log(`  major_projects: ${JSON.stringify(course?.majorProjects ?? [])}`);
  console.log(`  required_incoming_skills: ${JSON.stringify(course?.requiredIncomingSkills ?? [])}`);
  console.log();

  console.log('Materials:');
  const materials = await db.select().from(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
  const byPrefix: Record<string, number> = {};
  let totalChars = 0;
  let totalSummaryChars = 0;
  for (const m of materials) {
    const prefix = m.fileName.match(/^([A-Za-z][A-Za-z ]+?:)/)?.[1] ?? 'plain-upload';
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
    totalChars += (m.extractedText ?? '').length;
    totalSummaryChars += (m.digest ?? '').length;
  }
  console.log(`  total: ${materials.length}`);
  Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`    ${p.padEnd(20)} ${n}`));
  console.log(`  total extracted chars: ${totalChars.toLocaleString()} (~${Math.round(totalChars/4).toLocaleString()} tokens)`);
  console.log(`  summaries cached: ${materials.filter(m => m.digest).length} (${totalSummaryChars.toLocaleString()} chars)`);
  console.log(`  ignored: ${materials.filter(m => m.ignored).length}`);
  console.log();

  console.log('Materials detail:');
  for (const m of materials.sort((a, b) => (b.extractedText?.length ?? 0) - (a.extractedText?.length ?? 0))) {
    const chars = (m.extractedText ?? '').length;
    const useSummary = m.useDigest && m.digest;
    const auditChars = useSummary ? (m.digest ?? '').length : chars;
    console.log(`  ${m.fileName.slice(0, 60).padEnd(60)} ${(chars/1000).toFixed(1).padStart(7)}K chars  audit-uses=${(auditChars/1000).toFixed(1)}K${useSummary ? ' (summary)' : ''}${m.ignored ? ' [IGNORED]' : ''}`);
  }
  console.log();

  console.log('Draft profile — productive_failure_conditions:');
  const [draft] = await db.select().from(courseCaptureProfiles).where(eq(courseCaptureProfiles.courseCode, CODE));
  const profile = draft?.profile as Record<string, unknown> | undefined;
  const auditNotes = profile?.audit_notes as Record<string, unknown> | undefined;
  const pf = auditNotes?.productive_failure_conditions;
  console.log(JSON.stringify(pf, null, 2));
  console.log();

  console.log('Conversation transcript — looking for Audit Area 7 coverage:');
  const [conv] = await db.select().from(captureConversations).where(eq(captureConversations.courseCode, CODE));
  if (!conv) {
    console.log('  (no conversation)');
  } else {
    const msgs = conv.messages as Msg[];
    console.log(`  total messages: ${msgs.length}`);
    const pfKeywords = /productive[ -]failure|generate[ -]then[ -]consolidate|open[ -]ended|ill[ -]structured|revision cycle|post[ -]mortem|debrief|reflection|how (?:do|did) (?:you|students) (?:fail|struggle|reflect|debrief)/i;
    const hits = msgs
      .map((m, i) => ({ i, role: m.role, content: m.content, hit: pfKeywords.test(m.content) }))
      .filter(m => m.hit);
    console.log(`  messages mentioning PF/reflection keywords: ${hits.length}\n`);
    if (hits.length > 0) {
      console.log('  Hit excerpts (first 240 chars each):');
      hits.slice(0, 6).forEach(h => {
        console.log(`    [#${h.i} ${h.role}] ${h.content.slice(0, 240).replace(/\n/g, ' ')}${h.content.length > 240 ? '...' : ''}`);
      });
    } else {
      console.log('  NO mentions of productive-failure / reflection / debrief vocabulary in any message.');
      console.log();
      console.log('  Sample of last 3 messages for context:');
      msgs.slice(-3).forEach((m, i) => {
        const idx = msgs.length - 3 + i;
        console.log(`    [#${idx} ${m.role}] ${m.content.slice(0, 240).replace(/\n/g, ' ')}${m.content.length > 240 ? '...' : ''}`);
      });
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
