/**
 * Sync docs/wiki-research/*.md into the wiki repo's research/ folder (spec
 * 2026-10-14). Dry run by default; --apply writes, lints, commits only
 * research/ and pushes. Owner-gated against the real wiki; run in a quiet
 * window (no refresh-all / seed / capture writing the wiki at the same time).
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/wiki/sync-research.ts [--source docs/wiki-research] [--wiki <path>] [--apply]
 *
 * Exit: 0 ok · 2 bad args · 3 refused (validation, dirty clone, lint) · 1 other error.
 */
import path from 'node:path';
import { isMainModule } from '../catalog/catalog-source';
import { syncResearch, ResearchSyncRefusal } from '@/lib/wiki/research-sync';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let source = 'docs/wiki-research';
  let wiki = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--source' && argv[i + 1]) source = argv[++i]!;
    else if (a === '--wiki' && argv[i + 1]) wiki = argv[++i]!;
    else { console.error(`unknown or incomplete argument: ${a}`); return 2; }
  }
  console.log(`mode: ${apply ? 'APPLY' : 'dry run'}  source: ${path.resolve(source)}  wiki: ${path.resolve(wiki)}`);
  try {
    const r = await syncResearch({ sourceDir: source, wikiRoot: wiki, apply });
    console.log(`write: ${r.plan.write.join(', ') || '—'}`);
    console.log(`remove: ${r.plan.remove.join(', ') || '—'}`);
    console.log(`unchanged: ${r.plan.unchanged.length}`);
    console.log(!apply ? 'dry run — nothing written'
      : !r.sha ? 'nothing to commit (research/ already matches)'
      : r.committed ? `committed + pushed ${r.sha}`
      : `pushed earlier sync commit ${r.sha}; no new changes`);
    return 0;
  } catch (err) {
    if (err instanceof ResearchSyncRefusal) { console.error(`REFUSED: ${err.message}`); return 3; }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().then(code => process.exit(code));
}
