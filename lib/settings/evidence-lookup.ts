/** Pure lookups over the evidence register (safe in client components; the loader in ./evidence reads files). */
export interface Evidence {
  id: string;
  title: string;
  date: string;
  applies: string[];
  summary: string;
  /** The page text; empty when sent to the browser. */
  body: string;
}

/** The newest evidence for this function; else for its role, unless the function runs on a campus route of its own. */
export function evidenceFor(list: Evidence[], functionId: string, role: string, campusRouted: boolean): Evidence | null {
  return list.find(e => e.applies.includes(functionId))
    ?? (campusRouted ? null : list.find(e => e.applies.includes(`role:${role}`)) ?? null);
}

export function evidenceForKey(list: Evidence[], key: string): Evidence | null {
  return list.find(e => e.applies.includes(key)) ?? null;
}
