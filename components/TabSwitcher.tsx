'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export type AnalysisTab = 'target' | 'prereqs';

export function TabSwitcher({ active }: { active: AnalysisTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function switchTo(tab: AnalysisTab) {
    if (tab === active) return;
    const params = new URLSearchParams(search?.toString() ?? '');
    params.set('tab', tab);
    router.push(`${pathname}?${params.toString()}`);
  }

  const inactiveCls = 'rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground';
  const activeCls = 'rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium';

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => switchTo('target')} className={active === 'target' ? activeCls : inactiveCls}>
        Career-target alignment
      </button>
      <button type="button" onClick={() => switchTo('prereqs')} className={active === 'prereqs' ? activeCls : inactiveCls}>
        Prereqs feeding a course
      </button>
    </div>
  );
}
