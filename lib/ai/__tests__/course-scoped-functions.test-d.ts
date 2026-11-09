/** Part 2 Task 6: course-scoped AI calls must carry their course code (type test; checked by tsc). */
import { getProviderForFunction } from '@/lib/ai/provider';

export async function typeChecks(): Promise<void> {
  // a course-scoped function without a course code does not compile
  // @ts-expect-error course-scoped: needs { courseCode }
  await getProviderForFunction('capture-chat-agent');
  await getProviderForFunction('capture-chat-agent', { courseCode: 'GC 1010' });
  // program-wide functions take no course context
  await getProviderForFunction('wiki-update');
  // @ts-expect-error program-wide: no course context
  await getProviderForFunction('wiki-update', { courseCode: 'GC 1010' });
}
