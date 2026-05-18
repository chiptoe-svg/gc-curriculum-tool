'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SyncState {
  lastSyncedAt: string | null;
  lastSyncedCount: number;
  lastErrors: string[];
}

interface Props {
  slug: string;
  initialState: SyncState;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function CourseSyncCard({ slug, initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/resync-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(`Resync failed: ${res.status}`);
      const json = await res.json();
      setState({
        lastSyncedAt: json.lastSyncedAt,
        lastSyncedCount: json.synced,
        lastErrors: json.errors ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Course data — descriptions, learning objectives, projects, assumed skills —
          lives in a <a
            href="https://docs.google.com/spreadsheets/d/12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q/edit"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 text-foreground font-medium hover:text-primary"
          >shared Google Sheet</a>, one tab per course. Faculty edit their own tab directly;
          this page pulls the latest into the tool. Edits in the sheet aren&apos;t reflected
          in the prototype until you click <span className="font-medium">Resync</span>.
          {state.lastSyncedAt
            ? <> Last synced: <span className="font-medium text-foreground">{relativeTime(state.lastSyncedAt)}</span> ({state.lastSyncedCount} courses).</>
            : <> Never synced.</>}
        </p>
        <Button onClick={resync} disabled={busy}>
          {busy ? 'Syncing…' : 'Resync from Sheet'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {state.lastErrors.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {state.lastErrors.length} tab{state.lastErrors.length === 1 ? '' : 's'} failed on the last sync
            </summary>
            <ul className="list-disc pl-5 mt-2 text-muted-foreground">
              {state.lastErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
