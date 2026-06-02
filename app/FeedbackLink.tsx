'use client';

export const OPEN_FEEDBACK_EVENT = 'gc:open-feedback';

/**
 * Header link that opens the global feedback modal. Matches the visual
 * weight of the other utility links in route headers (Guide, Settings,
 * etc.) so the affordance reads as a real app feature rather than as
 * third-party browser chrome.
 *
 * The modal itself lives in `<FeedbackWidget />` (mounted globally in
 * `app/layout.tsx`); this component just dispatches a custom DOM event
 * so headers don't need to thread state through.
 */
export function FeedbackLink() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT))}
      className="text-sm text-muted-foreground hover:text-foreground"
      title="Send feedback about this page"
    >
      Feedback
    </button>
  );
}
