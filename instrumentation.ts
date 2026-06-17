/**
 * Next.js server-boot hook (runs once when `next start` / `next dev` boots).
 *
 * Arms the in-process background-ingest worker on startup so any materials left
 * `queued` (or stuck `indexing` from a crash/restart) drain immediately — rather
 * than waiting for the next upload to call enqueue(). Closes the worker's main
 * fragility: it's in-process and dies on restart, and previously only restarted
 * on the next enqueue. See docs/superpowers/specs/2026-06-16-background-ingest-design.md.
 */
export async function register() {
  // Only the Node.js runtime can reach Postgres (the worker uses node-postgres).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureWorker } = await import('@/lib/capture/ingest-queue');
    ensureWorker(); // runs boot-recovery (stuck 'indexing' → 'queued') then drains the backlog
    console.log('[instrumentation] background-ingest worker armed on boot');
  } catch (err) {
    // Never let a worker-arming failure block server startup.
    console.error('[instrumentation] failed to arm ingest worker:', err);
  }
}
