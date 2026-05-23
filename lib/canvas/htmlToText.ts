export function htmlToText(html: string): string {
  if (!html) return '';
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Preserve URLs from anchor tags: <a href="URL">Label</a> → "Label (URL)".
  // Without this, downstream consumers (CourseCapture audit, Google Docs scan)
  // lose every linked-doc reference. Skip non-http(s) hrefs and skip when the
  // label IS the URL to avoid duplication like "https://x (https://x)".
  text = text.replace(
    /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      if (!label) return href;
      if (label === href) return href;
      return `${label} (${href})`;
    },
  );

  text = text.replace(/<\/?(p|div|br|li|h[1-6]|tr|td|th|blockquote|pre|ul|ol)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#?(\w+);/gi, (_, e) => {
      if (/^\d+$/.test(e)) return String.fromCharCode(parseInt(e, 10));
      return '';
    })
    .replace(/&nbsp;/gi, ' ');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
