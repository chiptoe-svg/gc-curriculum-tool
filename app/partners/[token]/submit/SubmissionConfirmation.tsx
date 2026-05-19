'use client';

import Link from 'next/link';

interface Props {
  title: string;
  token: string;
  onAddAnother: () => void;
}

export function SubmissionConfirmation({ title, token, onAddAnother }: Props) {
  const base = `/partners/${token}`;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Got it — thank you.</h1>
        <p className="mt-2 text-slate-700">We&apos;ve recorded <strong>{title}</strong>. You can describe another position, rate student projects, or finish up.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAddAnother}
          className="rounded bg-slate-800 px-5 py-2 text-sm text-white"
        >
          Add another position
        </button>
        <Link href={base} className="rounded border border-slate-300 px-5 py-2 text-sm">
          See my submissions
        </Link>
        <Link href={`${base}/done`} className="rounded border border-slate-300 px-5 py-2 text-sm">
          I&apos;m done
        </Link>
      </div>
    </div>
  );
}
