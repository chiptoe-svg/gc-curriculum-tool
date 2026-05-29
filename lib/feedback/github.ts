/**
 * Compose a feedback issue body + call the GitHub REST API.
 *
 * Reads GITHUB_TOKEN (PAT, repo scope) + GITHUB_FEEDBACK_REPO ("owner/repo").
 * Returns either { ok: true, issueUrl, issueNumber } or { ok: false, reason }.
 *
 * `reason: 'not-configured'` is the sentinel the route uses to surface a 503
 * with a useful message when the env vars aren't set — distinct from a
 * GitHub-API transport failure.
 */

export interface FeedbackInput {
  name: string | null;
  feedback: string;
  route: string;
  courseCode: string | null;
  userAgent: string;
  capturedAt: string;
}

export interface CreateFeedbackIssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  reason?: 'not-configured' | 'github-error' | string;
  errorDetail?: string;
}

function titleFromFeedback(input: FeedbackInput): string {
  const who = input.name ? `${input.name}: ` : '';
  const head = input.feedback.replace(/\s+/g, ' ').trim().slice(0, 70);
  const ellipsis = input.feedback.trim().length > 70 ? '…' : '';
  return `feedback — ${who}${head}${ellipsis}`;
}

function bodyFromFeedback(input: FeedbackInput): string {
  return [
    `**From:** ${input.name ?? '_(anonymous)_'}`,
    `**Route:** \`${input.route}\``,
    input.courseCode ? `**Course:** ${input.courseCode}` : null,
    `**Captured:** ${input.capturedAt}`,
    `**User agent:** \`${input.userAgent}\``,
    '',
    '---',
    '',
    input.feedback.trim(),
  ].filter(Boolean).join('\n');
}

export async function createFeedbackIssue(input: FeedbackInput): Promise<CreateFeedbackIssueResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
  if (!token || !repo) {
    return { ok: false, reason: 'not-configured' };
  }
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    return { ok: false, reason: 'not-configured', errorDetail: 'GITHUB_FEEDBACK_REPO must be "owner/repo"' };
  }

  const url = `https://api.github.com/repos/${repo}/issues`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'gc-curriculum-tool/feedback',
      },
      body: JSON.stringify({
        title: titleFromFeedback(input),
        body: bodyFromFeedback(input),
        labels: ['gc-feedback'],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: 'github-error', errorDetail: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    const data = await res.json() as { html_url: string; number: number };
    return { ok: true, issueUrl: data.html_url, issueNumber: data.number };
  } catch (err) {
    return { ok: false, reason: 'github-error', errorDetail: err instanceof Error ? err.message : String(err) };
  }
}
