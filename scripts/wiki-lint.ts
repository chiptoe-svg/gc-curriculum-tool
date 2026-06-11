/**
 * gc-wiki-lint CLI — `pnpm wiki:lint`.
 * Deterministic structural check of the compiled wiki (no LLM). Exits non-zero
 * if any error-severity issues are found, so it can gate CI / the compile loop.
 */
import { lintWiki, summarizeLint } from '@/lib/ai/wiki/lint';

async function main() {
  const issues = await lintWiki();
  console.log(summarizeLint(issues));
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.page} — ${i.kind}: ${i.detail}`);
  }
  const errors = issues.filter(i => i.severity === 'error').length;
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('wiki-lint failed:', e);
  process.exit(2);
});
