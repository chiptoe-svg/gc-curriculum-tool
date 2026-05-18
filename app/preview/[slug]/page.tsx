import { notFound } from 'next/navigation';
import { isValidSlug } from '@/lib/slug';
import { PrototypeClient } from './PrototypeClient';

export const dynamic = 'force-dynamic';

export default async function PreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) {
    notFound();
  }
  return <PrototypeClient />;
}
