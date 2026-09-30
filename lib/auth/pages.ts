const STYLE = `body{font:16px/1.55 system-ui,-apple-system,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1b1d21}h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#4b5563}a{color:#1b1d21;text-decoration:underline;text-decoration-color:#f56600;text-underline-offset:3px}`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}
export function unauthorizedPage(): string {
  return page('Sign in to continue',
    `<p>Faculty: open the access link you were given, or sign in with the department login when your browser asks.</p>` +
    `<p>Students and visitors: the <a href="/">course list</a>, course pages and the <a href="/wiki">curriculum wiki</a> need no login.</p>`);
}
export function forbiddenPage(label: string, code?: string): string {
  const what = code ? `can edit ${esc(code)}` : 'has the access it was given';
  return page("This link can’t do that",
    `<p>The access link <strong>${esc(label)}</strong> ${code ? `is not allowed to edit <strong>${esc(code)}</strong>` : 'is not allowed to make this change'}; it ${what} only.</p>` +
    `<p>Ask the department for a wider link if you need it. <a href="/">Back to the course list</a>.</p>`);
}
