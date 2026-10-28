import { joinTurnParts, splitTurnText } from '@/lib/capture/merge-turn-text';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

/** The fields of an interviewer reply that go into the transcript. */
export interface TurnReply {
  finding?: string;
  question?: string;
  citations?: ChatMessage['citations'];
}

/**
 * The transcript message for one interviewer reply. Shared by the chat panel
 * (what it shows) and the chat route (what it saves), so a refresh restores
 * exactly what was on screen.
 *
 * The prompt keeps the follow-up question in the `question` field only.
 * splitTurnText is the defense-in-depth: if a turn still ends its `finding`
 * with a (possibly reworded) question, that paragraph becomes the question and
 * the field isn't added again, so faculty never see the question twice.
 * `content` stays the merged text the saved conversation expects.
 */
export function assistantTurnMessage(reply: TurnReply): ChatMessage {
  const parts = splitTurnText(reply.finding ?? '', reply.question ?? '');
  return {
    role: 'assistant',
    content: joinTurnParts(parts),
    ...(parts.question ? { question: parts.question } : {}),
    ...(Array.isArray(reply.citations) && reply.citations.length > 0 ? { citations: reply.citations } : {}),
  };
}
