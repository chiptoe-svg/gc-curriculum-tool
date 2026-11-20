import Link from 'next/link';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import {
  AI_FUNCTION_IDS,
  DEFAULT_ROLES,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_LABELS,
  listAllFunctionSettings,
  FUNCTION_PROVIDER_DEFAULTS,
} from '@/lib/ai/function-settings';
import { ROLE_SETTINGS } from '@/lib/ai/models';
import { getDailyCapCents, getDailyCostHistory } from '@/lib/rate-limit/daily-cap';
import { getViewerAccess } from '@/lib/auth/viewer';
import { SettingsClient, type SearchState } from './SettingsClient';
import { loadEvidence } from '@/lib/settings/evidence';
import { getRerankOverride, rerankEnabledNow } from '@/lib/settings/app-settings';
import { DEFAULT_RERANK_MODEL } from '@/lib/ai/rerank';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';

import './settings.css';

async function loadSearch(): Promise<SearchState | null> {
  try {
    return {
      rerank: { override: await getRerankOverride(), effective: await rerankEnabledNow(), model: process.env.RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL },
      embedding: { model: DEFAULT_EMBEDDING_MODEL },
    };
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function SettingsPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="st-title">Access link required</h1>
        <p className="st-meta mt-3">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }

  const [settings, costHistory, { isAdmin }, search] = await Promise.all([
    listAllFunctionSettings(),
    getDailyCostHistory(14),
    getViewerAccess(await headers()),
    loadSearch(),
  ]);
  const evidence = loadEvidence().map(e => ({ ...e, body: '' }));
  const capCents = getDailyCapCents();

  return (
    <div className="min-h-screen bg-background">
      <header className="st-header">
        <div className="st-header-inner">
          <div>
            <p className="st-eyebrow">Settings</p>
            <h1 className="st-title">AI model selection</h1>
          </div>
          <div className="st-nav">
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="st-btn">← Hub</Link>
          </div>
        </div>
      </header>
      <main className="st-main">
        <SettingsClient
          slug={slug}
          initialSettings={settings}
          roles={ROLE_SETTINGS}
          routes={FUNCTION_PROVIDER_DEFAULTS}
          defaults={DEFAULT_ROLES}
          labels={FUNCTION_LABELS}
          descriptions={FUNCTION_DESCRIPTIONS}
          functionIds={[...AI_FUNCTION_IDS]}
          costHistory={costHistory}
          capCents={capCents}
          isAdmin={isAdmin}
          evidence={evidence}
          search={search}
        />
      </main>
    </div>
  );
}
