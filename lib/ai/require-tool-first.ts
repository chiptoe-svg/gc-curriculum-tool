/**
 * A Vercel AI SDK `prepareStep` that makes the model call one of `tools` on the
 * first step of a tool loop (tool_choice "required", only those tools active),
 * then leaves later steps free. Used by the interviewer when the exchange points
 * at course files (lib/ai/agent/interview-controls.ts). undefined = no requirement.
 */
export function requireToolFirstStep(
  tools: string[] | undefined,
): ((opts: { stepNumber: number }) => { toolChoice: 'required'; activeTools: string[] } | undefined) | undefined {
  if (!tools?.length) return undefined;
  return ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: 'required', activeTools: tools } : undefined);
}
