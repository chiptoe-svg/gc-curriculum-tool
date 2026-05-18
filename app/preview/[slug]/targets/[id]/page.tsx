import { notFound } from 'next/navigation';
import { isValidSlug } from '@/lib/slug';
import { TargetEditClient } from './TargetEditClient';

export const dynamic = 'force-dynamic';

export default async function TargetEditPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!isValidSlug(slug)) notFound();

  return <TargetEditClient slug={slug} targetId={id} />;
}
