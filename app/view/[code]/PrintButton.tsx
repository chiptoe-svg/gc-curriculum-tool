'use client';

/**
 * "Save as PDF" — opens the browser print dialog for the course view. The
 * print stylesheet (app/globals.css `@media print`) hides the page chrome
 * (nav links, this button) and keeps the profile's card/band colors, so the
 * browser's "Save as PDF" produces a clean printed profile. No server-side
 * rendering / headless browser needed; fully on-box.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-sm text-muted-foreground hover:text-foreground"
      title="Print or save this course profile as a PDF"
    >
      ↓ PDF
    </button>
  );
}
