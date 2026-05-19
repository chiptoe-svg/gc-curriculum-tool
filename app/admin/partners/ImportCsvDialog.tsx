'use client';

import { useState, useTransition } from 'react';

export function ImportCsvDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<null | { inserted: number; skipped: number; errors: { row: number; message: string }[]; sendFailures?: { email: string; message: string }[] }>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
  }

  function submit() {
    start(async () => {
      const res = await fetch('/api/admin/partners/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, csv }),
      });
      const json = await res.json();
      setResult(json);
      if (res.ok) window.location.reload();
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded bg-slate-800 px-4 py-2 text-sm text-white">
        Import CSV
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl space-y-4 rounded bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import partners from CSV</h2>
          <button onClick={() => { setOpen(false); setCsv(''); setResult(null); }} className="text-slate-500">✕</button>
        </div>
        <p className="text-xs text-slate-600">
          Required columns: <code>email,firstName,lastName,company,roleTitle,weight,careerTargetHints</code>.
          weight defaults to 1; multiple careerTargetHints separated by <code>|</code>.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {csv && (
          <textarea
            className="h-40 w-full rounded border border-slate-300 p-2 font-mono text-xs"
            value={csv}
            readOnly
          />
        )}
        {result && (
          <div className="rounded border border-slate-200 p-3 text-sm">
            <p>Inserted: <strong>{result.inserted}</strong> · Skipped duplicates: <strong>{result.skipped}</strong></p>
            {result.errors.length > 0 && (
              <div className="mt-2 text-red-700">
                <p>Row errors:</p>
                <ul className="ml-4 list-disc">{result.errors.map((e, i) => <li key={i}>row {e.row}: {e.message}</li>)}</ul>
              </div>
            )}
            {result.sendFailures && result.sendFailures.length > 0 && (
              <div className="mt-2 text-amber-700">
                <p>Send failures:</p>
                <ul className="ml-4 list-disc">{result.sendFailures.map((f, i) => <li key={i}>{f.email}: {f.message}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => { setCsv(''); setResult(null); }} className="text-sm text-slate-600">Clear</button>
          <button
            onClick={submit}
            disabled={!csv || pending}
            className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? 'Importing…' : 'Import + send invites'}
          </button>
        </div>
      </div>
    </div>
  );
}
