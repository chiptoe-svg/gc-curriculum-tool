import type { CanvasCourseData } from '@/lib/canvas/fetchCanvasCourse';
import { htmlToText } from '@/lib/canvas/htmlToText';

export interface AssembledMaterial { fileName: string; text: string; mimeType: string; }

/**
 * Turn fetched/parsed Canvas content into the `Canvas:` text materials. Shared by
 * the Canvas-API import and the IMSCC import so both produce identical materials.
 * `sheetsHasCatalog` suppresses `Canvas: Syllabus` when the Google-Sheet catalog
 * already supplies learning objectives.
 */
export function assembleCanvasMaterials(
  data: CanvasCourseData,
  opts: { sheetsHasCatalog: boolean },
): AssembledMaterial[] {
  const { sheetsHasCatalog } = opts;
  const toInsert: AssembledMaterial[] = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  // Suppress Canvas: Syllabus when the curated Sheets catalog already has LOs.
  // The Sheets row is the structured source of truth; the Canvas Syllabus page
  // tends to be a rambling, often-stale duplicate. Faculty can re-include by
  // un-ignoring the row in the Materials panel if Sheets is missing structure.
  if (syllabusText && !sheetsHasCatalog) {
    toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText, mimeType: 'text/html' });
  } else if (syllabusText && sheetsHasCatalog) {
    console.log(`[canvas-import] suppressed Canvas: Syllabus (Sheets has LOs)`);
  }

  if (data.assignments.length > 0) {
    const parts = data.assignments.map(a => {
      const desc = htmlToText(a.descriptionHtml);
      const pts = a.pointsPossible != null ? ` (${a.pointsPossible} pts)` : '';
      const status = a.published ? '' : ' [unpublished]';
      const header = `## ${a.name}${pts}${status}`;
      // Rubric criteria are what faculty actually grade against. Including
      // them inline gives the auditor the "what we grade for" picture that
      // the assignment description alone often doesn't carry.
      let rubricBlock = '';
      if (a.rubric.length > 0) {
        const lines: string[] = [];
        const rubricHeader = a.rubricTitle ? `Rubric — ${a.rubricTitle}:` : 'Rubric:';
        lines.push('', rubricHeader);
        for (const c of a.rubric) {
          const ptsLabel = c.points != null ? ` (${c.points} pts)` : '';
          const detail = c.longDescription && c.longDescription !== c.description
            ? ` — ${c.longDescription}`
            : '';
          lines.push(`- ${c.description}${ptsLabel}${detail}`);
          if (c.ratings.length > 0) {
            const ratingLine = c.ratings
              .map(r => `${r.points != null ? `${r.points} pts: ` : ''}${r.description}`)
              .join(' / ');
            lines.push(`  ratings: ${ratingLine}`);
          }
        }
        rubricBlock = lines.join('\n');
      }
      return [header, desc, rubricBlock].filter(Boolean).join('\n');
    });
    const assignmentsText = parts.join('\n\n');
    if (assignmentsText.trim()) toInsert.push({ fileName: 'Canvas: Assignments', text: assignmentsText, mimeType: 'text/html' });
  }

  if (data.modules.length > 0) {
    const parts = data.modules.map(m => {
      const items = m.items.map(i => {
        // Surface the URL for ExternalUrl items so downstream consumers
        // (audit, Google Docs scan) can follow the link.
        const linkSuffix = i.externalUrl ? ` → ${i.externalUrl}` : '';
        const itemStatus = i.published ? '' : ' [unpublished]';
        return `  - ${i.title} (${i.type})${itemStatus}${linkSuffix}`;
      }).join('\n');
      const modStatus = m.published ? '' : ' [unpublished]';
      return `## ${m.name}${modStatus}\n${items}`;
    });
    const modulesText = parts.join('\n\n');
    if (modulesText.trim()) toInsert.push({ fileName: 'Canvas: Module List', text: modulesText, mimeType: 'text/html' });
  }

  if (data.pages.length > 0) {
    // Canvas Pages are wiki-style content embedded in the course. Many
    // courses house substantive lecture material here that's otherwise
    // invisible to the auditor. Render each page's body as plain text
    // beneath its title, separated by section breaks.
    const parts = data.pages
      .map(p => {
        const body = htmlToText(p.bodyHtml);
        if (!body.trim()) return '';
        const status = p.published ? '' : ' [unpublished]';
        return `## ${p.title}${status}\n${body}`;
      })
      .filter(Boolean);
    const pagesText = parts.join('\n\n---\n\n');
    if (pagesText.trim()) toInsert.push({ fileName: 'Canvas: Pages', text: pagesText, mimeType: 'text/html' });
  }

  if (data.discussions.length > 0) {
    const parts = data.discussions
      .map(d => {
        const body = htmlToText(d.messageHtml);
        if (!body.trim() && !d.isAssignment) return '';
        const tags = [
          d.isAssignment ? 'graded' : null,
          !d.published ? 'unpublished' : null,
        ].filter(Boolean).join(', ');
        const suffix = tags ? ` [${tags}]` : '';
        return `## ${d.title}${suffix}\n${body || '(prompt text empty)'}`;
      })
      .filter(Boolean);
    const discussionsText = parts.join('\n\n---\n\n');
    if (discussionsText.trim()) toInsert.push({ fileName: 'Canvas: Discussions', text: discussionsText, mimeType: 'text/html' });
  }

  if (data.quizzes.length > 0) {
    const parts = data.quizzes.map(q => {
      const pts = q.pointsPossible != null ? ` (${q.pointsPossible} pts)` : '';
      const desc = htmlToText(q.descriptionHtml);
      const tags = [`${q.source} quiz`, q.published ? null : 'unpublished']
        .filter(Boolean).join(', ');
      const lines: string[] = [`## ${q.title}${pts} [${tags}]`];
      if (desc.trim()) lines.push(desc);
      if (q.questions.length > 0) {
        lines.push('', 'Questions:');
        q.questions.forEach((question, i) => {
          const qPts = question.pointsPossible != null ? ` (${question.pointsPossible} pts)` : '';
          const qText = htmlToText(question.textHtml).trim() || question.name;
          lines.push(`Q${i + 1} [${question.questionType}]${qPts}: ${qText}`);
          if (question.answers.length > 0) {
            question.answers.forEach((a, j) => {
              const label = String.fromCharCode(97 + j);  // a, b, c, ...
              const mark = a.correct ? ' ✓' : '';
              lines.push(`  ${label}. ${a.text}${mark}`);
            });
          }
        });
      } else if (q.questionCount && q.questionCount > 0) {
        lines.push(`(${q.questionCount} questions — text not exposed via API)`);
      }
      return lines.join('\n');
    });
    const quizzesText = parts.join('\n\n---\n\n');
    if (quizzesText.trim()) toInsert.push({ fileName: 'Canvas: Quizzes', text: quizzesText, mimeType: 'text/html' });
  }

  return toInsert;
}
