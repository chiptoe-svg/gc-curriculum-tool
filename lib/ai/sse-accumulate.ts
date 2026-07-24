/**
 * Accumulate assistant text from an OpenAI-style SSE `chat/completions` stream.
 *
 * gcspark's vision offload MUST be streamed: the loopback forwarder
 * (com.gc.dgx-forward) stalls non-streamed responses ~15s (keep-alive/buffering
 * interaction), while a streamed response returns in ~1s. The accumulated text is
 * byte-identical to the non-streamed `message.content` — streaming only changes
 * delivery, not the generation. Reads `data:` lines, concatenates
 * `choices[0].delta.content`, and stops at `[DONE]`.
 */
export async function accumulateSseContent(res: Response): Promise<string> {
  if (!res.body) throw new Error('SSE response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // skip SSE comments / keep-alives
      const data = line.slice(5).trim();
      if (data === '[DONE]') return content;
      try {
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        content += chunk.choices?.[0]?.delta?.content ?? '';
      } catch {
        // non-JSON data line (e.g. a keep-alive) — ignore
      }
    }
  }
  return content;
}
