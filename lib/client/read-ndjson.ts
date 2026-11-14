/** Reads a streamed NDJSON response, calling `onEvent` once per line. */
export async function readNdjson(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error('no body to stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed lines — server only emits valid JSON per line
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail)); } catch { /* ignore */ }
  }
}
