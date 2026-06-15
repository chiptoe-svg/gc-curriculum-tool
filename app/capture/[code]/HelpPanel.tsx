'use client';

/**
 * Collapsed-by-default help panel for the capture page. Surfaces the
 * non-obvious mechanics (Materials panel indicators, top-button purposes,
 * audit mode, conversational workflow) so faculty don't have to reverse-
 * engineer the UI from behavior. Short-term affordance — replace with
 * tooltips on individual controls if/when this content lives in too many
 * places.
 */
export function CaptureHelpPanel() {
  return (
    <details className="group rounded-md border bg-amber-50/40 px-4 py-3">
      <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-foreground select-none">
        <span>
          <span className="mr-1.5 text-amber-700">?</span>
          How this page works
        </span>
        <span className="text-xs text-muted-foreground group-open:hidden">click to expand</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">click to collapse</span>
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed text-foreground">

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Materials panel — what the indicators mean
          </h4>
          <ul className="space-y-1.5 pl-1">
            <li>
              <span className="inline-block w-4 text-center text-emerald-600">●</span>
              <strong>Green dot</strong> — material is indexed and the interview agent can retrieve from it during the chat (search tools point here).
            </li>
            <li>
              <span className="inline-block w-4 text-center text-muted-foreground">○</span>
              <strong>Gray dot</strong> — material is set aside (ignored). It stays in the database but is invisible to the agent. Common reasons:
              <ul className="mt-1 ml-5 list-disc space-y-0.5 text-muted-foreground">
                <li>
                  <em>Canvas: Syllabus</em> is auto-ignored when your Sheets catalog already lists learning objectives, projects, and skills — the syllabus content is redundant.
                </li>
                <li>
                  Files with a red token count (e.g. <em>~131k tok</em>) are auto-set-aside because they exceed the summary size limit. Usually safe to leave ignored unless the file is genuinely interview-relevant.
                </li>
                <li>
                  Gradebook / attendance / roster spreadsheets are auto-ignored as likely student data.
                </li>
              </ul>
            </li>
            <li>
              <strong>&ldquo;AI summary&rdquo; checkbox</strong> — when checked, the agent reads a ~700–900-token structured summary of this material in its at-rest context every turn. It can still pull the full chunked content via search tools when it needs precise wording. Leave checked unless the material is short enough that the agent can read it whole.
            </li>
            <li>
              <strong>&ldquo;ignore&rdquo; checkbox</strong> — exclude entirely from the interview. The file stays in the database (you can un-ignore later) but the agent never sees it. Use to manually override an auto-included material the agent shouldn&apos;t reason about.
            </li>
          </ul>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top buttons — when to use each
          </h4>
          <dl className="space-y-1.5 pl-1">
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 font-medium">Re-extract Canvas files</dt>
              <dd className="text-muted-foreground">Only if you suspect the extracted text is stale (e.g. you re-uploaded a rubric in Canvas). Skip otherwise.</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 font-medium">Regenerate AI summaries</dt>
              <dd className="text-muted-foreground">Only if you&apos;ve materially changed how the AI summaries are generated. Skip on a normal interview.</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 font-medium">Scan linked files</dt>
              <dd className="text-muted-foreground">Pulls any new docs referenced from Canvas pages or assignments. Skip unless you&apos;ve just added linked content.</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 font-medium">Import from Canvas</dt>
              <dd className="text-muted-foreground">Re-syncs the materials list from Canvas. Skip unless you&apos;ve added or removed assignments since the last import.</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Interview mode (toggle near the bottom of the Materials panel)
          </h4>
          <p className="text-foreground">
            <strong>Full</strong> — agent has three retrieval tools and can search the indexed materials during the conversation. <em>Use this unless you have a specific reason not to.</em>
          </p>
          <p className="mt-1 text-muted-foreground">
            <strong>Simple</strong> — agent skips tools and interviews only from the at-rest AI summaries. Faster but less precise; the agent can&apos;t quote rubric language verbatim.
          </p>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            The interview conversation
          </h4>
          <ol className="ml-5 list-decimal space-y-1 text-foreground">
            <li>
              <strong>Have a conversation with the interviewer.</strong> It opens with a summary of what it sees in your materials, names the most consequential gap or question, and asks one focused follow-up. Reply in your own language — the agent translates internally.
            </li>
            <li>
              <strong>Push back when something&apos;s wrong.</strong> If the agent misses something — a non-text assessment, a studio critique, a graded artifact that lives outside the rubric — say so. It will incorporate the correction.
            </li>
            <li>
              <strong>Watch the readiness strip.</strong> It climbs as the interview covers more ground. Around 75% the agent will signal it has enough to generate a Course Outcome Profile.
            </li>
            <li>
              <strong>Generate the profile when ready.</strong> Click &ldquo;Generate Course Outcome Profile&rdquo; — the synthesis call produces a structured profile with KUD+ depth ratings + citations to your materials and your replies. Review, edit, and snapshot it.
            </li>
          </ol>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What the interviewer will and will not do
          </h4>
          <ul className="space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Will:</strong> push back on aspirational syllabus language and ask for student-produced evidence (&ldquo;show me where students actually demonstrate X&rdquo;).</li>
            <li><strong className="text-foreground">Will:</strong> ask one focused question per turn and cite specific materials by name.</li>
            <li><strong className="text-foreground">Will not:</strong> use K/U/D framework vocabulary in the conversation — it translates to plain language for you.</li>
            <li><strong className="text-foreground">Will not:</strong> score against career targets — that comes later in Explore + Program views.</li>
          </ul>
        </section>

      </div>
    </details>
  );
}
