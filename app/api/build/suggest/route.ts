import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { db } from '@/lib/db/client';
import { itemEmbeddings } from '@/lib/db/schema';
import { cosineSimilarity, embedText } from '@/lib/ai/embeddings';

const TOP = 8;
const MAX_CHARS = 4000;

/**
 * POST /api/build/suggest  Body: { text }
 * Competencies whose bundle card sits nearest a course description, by the
 * campus embedding model (no charge). A shortlist for a person to pick from
 * and set levels on: the embedding never sets a level itself.
 * → 200 { suggestions: [{ competencyId, similarity }] }
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let text = '';
  try {
    const body = await req.json();
    if (body && typeof body.text === 'string') text = body.text.trim().slice(0, MAX_CHARS);
  } catch { /* handled below */ }
  if (text.length < 12) return NextResponse.json({ error: 'Write a sentence or two about the course first.' }, { status: 400 });

  let vector: number[];
  try {
    vector = await embedText(text);
  } catch {
    return NextResponse.json({ error: 'The campus embedding service did not answer. Pick competencies by hand for now.' }, { status: 502 });
  }
  const cards = await db.select({ ref: itemEmbeddings.ref, vector: itemEmbeddings.vector, createdAt: itemEmbeddings.createdAt })
    .from(itemEmbeddings).where(eq(itemEmbeddings.kind, 'bundle_card'));
  const newest = new Map<string, { vector: number[]; createdAt: Date }>();
  for (const c of cards) {
    const prev = newest.get(c.ref);
    if (!prev || c.createdAt > prev.createdAt) newest.set(c.ref, c);
  }
  const suggestions = [...newest.entries()]
    .filter(([, c]) => c.vector.length === vector.length)
    .map(([competencyId, c]) => ({ competencyId, similarity: cosineSimilarity(vector, c.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, TOP);
  return NextResponse.json({ suggestions });
}
