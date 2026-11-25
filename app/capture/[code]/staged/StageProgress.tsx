import type { EngineState } from '@/lib/capture/staged/engine';

/** "Stage N of 6" for a staged interview: where the conversation is, in the order it will go. Replaces the checklist. */
export function StageProgress({
  progress,
  questionsAsked,
  cap,
}: {
  progress: EngineState['stageProgress'];
  questionsAsked: number;
  cap: number;
}) {
  const current = progress.find(p => p.status === 'active') ?? progress[progress.length - 1];
  return (
    <aside data-testid="stage-progress" aria-label="Interview stages" className="space-y-3 text-xs">
      {current && <h3 className="cap-title text-base">Stage {current.id} of {progress.length} — {current.title}</h3>}
      <ol className="space-y-1.5">
        {progress.map(p => (
          <li
            key={p.id}
            data-status={p.status}
            aria-current={p.status === 'active' ? 'step' : undefined}
            className={
              'flex gap-1.5 leading-snug '
              + (p.status === 'active' ? 'font-semibold text-[#522D80]' : p.status === 'done' ? 'text-[#2F6B3A]' : 'text-[#9C97A6]')
            }
          >
            <span className="w-3 shrink-0 text-center" aria-hidden>{p.status === 'done' ? '✓' : p.status === 'active' ? '●' : '○'}</span>
            <span>
              {p.title}
              {p.status === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="leading-snug text-muted-foreground">{questionsAsked} of up to {cap} questions asked.</p>
    </aside>
  );
}
