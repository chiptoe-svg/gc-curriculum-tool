import { createHash } from 'node:crypto';
import { runPiTask } from '@/lib/ai/agent/pi/task';
import { piEndpointFor } from '@/lib/ai/agent/pi/endpoint';
import { buildAuditTools } from '@/lib/ai/agent/audit-tools';
import { includedMaterialsOf, renderAtRestContext } from '@/lib/ai/agent/audit-agent';
import { loadSkill } from '@/lib/ai/skills/load-skill';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { EvidenceMapJsonSchema, EvidenceMapSchema, clampEvidenceMap, type EvidenceMap } from './evidence-map';

export type PreReadResult = { map: EvidenceMap | null; status: 'ready' | 'failed' | 'none'; fingerprint: string | null };

export const PRE_READ_TIMEOUT_MS = 180_000;
/** A 'pending' read older than this (timeout + 60 s) died without saving and may be claimed again. */
export const PRE_READ_STALE_MS = PRE_READ_TIMEOUT_MS + 60_000;
const READ_TOOLS = ['search_materials', 'fetch_material_section', 'list_materials'];

/**
 * sha256 of the sorted `id:timestamp` of the included materials. course_materials has no updated_at
 * column, so the timestamp is uploaded_at: a replaced file is a new row (new id), and the only in-place
 * changes (ignore, set aside, retire) drop the row from the included set.
 */
export function materialsFingerprint(included: Array<{ id: string; uploadedAt: Date | string }>): string {
  const parts = included.map(m => `${m.id}:${new Date(m.uploadedAt).toISOString()}`).sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** Stage 0: read the course's materials once and build the evidence map. Never throws. */
export async function runPreRead(courseCode: string): Promise<PreReadResult> {
  let fingerprint: string | null = null;
  try {
    const [course, materials] = await Promise.all([getCourseByCode(courseCode), listMaterialsByCourse(courseCode)]);
    if (!course) throw new Error(`course not found: ${courseCode}`);
    const included = includedMaterialsOf(materials);
    if (!included.length) return { map: null, status: 'none', fingerprint: null };
    fingerprint = materialsFingerprint(included);

    const tools = buildAuditTools(courseCode).filter(t => READ_TOOLS.includes(t.name));
    const endpoint = await piEndpointFor();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRE_READ_TIMEOUT_MS);
    try {
      const r = await runPiTask<unknown>({
        systemPrompt: loadSkill('interview-pre-read').body,
        userMessage: renderAtRestContext(course, materials, 'digests'),
        tools,
        submitSchema: EvidenceMapJsonSchema,
        submitDescription: 'Deliver the evidence map.',
        endpoint,
        maxToolCalls: 40,
        signal: controller.signal,
      });
      console.info(`[pre-read] ${courseCode}: ${r.ms} ms, ${r.usdUnits} spend units`);
      await recordSpend(r.usdUnits).catch(err => console.error(`[pre-read] ${courseCode}: recordSpend failed`, err));
      const { value, clamped } = clampEvidenceMap(r.value);
      if (clamped) console.warn(`[pre-read] ${courseCode}: clamped ${clamped} over-limit string/list value(s) in the model's map`);
      return { map: EvidenceMapSchema.parse(value), status: 'ready', fingerprint };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(`[pre-read] ${courseCode}: failed:`, err instanceof Error ? err.message : err);
    // A failed or timed-out read still spent tokens (runPiTask puts them on the error).
    const spent = (err as { usage?: { usdUnits?: number } } | null)?.usage?.usdUnits;
    if (typeof spent === 'number') await recordSpend(spent).catch(e => console.error(`[pre-read] ${courseCode}: recordSpend failed`, e));
    return { map: null, status: 'failed', fingerprint };
  }
}
