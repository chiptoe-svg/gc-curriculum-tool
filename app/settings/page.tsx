import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import {
  AI_FUNCTION_IDS,
  DEFAULT_TIERS,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_LABELS,
  TIER_TO_MODEL,
  listAllFunctionSettings,
} from '@/lib/ai/function-settings';
import { SettingsClient } from './SettingsClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function SettingsPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }

  const settings = await listAllFunctionSettings();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Settings</p>
            <h1 className="mt-0.5 text-xl font-semibold">AI model selection</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="hover:text-foreground">← Hub</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">
        <SettingsClient
          slug={slug}
          initialSettings={settings}
          tierToModel={TIER_TO_MODEL}
          defaults={DEFAULT_TIERS}
          labels={FUNCTION_LABELS}
          descriptions={FUNCTION_DESCRIPTIONS}
          functionIds={[...AI_FUNCTION_IDS]}
        />
      </main>
    </div>
  );
}
