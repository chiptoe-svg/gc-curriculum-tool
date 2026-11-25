/**
 * Shortfall trace: reads the extract JSON plus one or more faculty worksheet pairs (CSV exports) and writes a Markdown report.
 * Read-only, no AI, no database. Plan: docs/superpowers/plans/2026-11-24-shortfall-trace-test.md (step 4).
 *
 * Usage:
 *   pnpm tsx scripts/analysis/shortfall-trace.ts --input extract.json --out report.md \
 *     --faculty "Name=required.csv,links.csv" [--faculty "Name2=required2.csv,links2.csv"] [--synthetic]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze } from './shortfall-trace/model';
import { readLinks, readRequired } from './shortfall-trace/worksheet';
import { buildInput, renderReport, type Run } from './shortfall-trace/report';
import type { Extract } from './shortfall-trace/extract-build';

function parseArgs(argv: string[]) {
  const faculty: Array<{ name: string; required: string; links: string }> = [];
  let input = '', out = '', synthetic = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--input') input = argv[++i] ?? '';
    else if (a === '--out') out = argv[++i] ?? '';
    else if (a === '--synthetic') synthetic = true;
    else if (a === '--faculty') {
      const v = argv[++i] ?? '';
      const m = /^([^=]+)=([^,]+),(.+)$/.exec(v);
      if (!m) throw new Error(`--faculty expects "Name=required.csv,links.csv", got "${v}"`);
      faculty.push({ name: m[1]!, required: m[2]!, links: m[3]! });
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!input || !out || faculty.length === 0) throw new Error('need --input, --out and at least one --faculty');
  return { input, out, synthetic, faculty };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const extract = JSON.parse(readFileSync(args.input, 'utf8')) as Extract;
  const comps = extract.competencies.map(c => ({ id: c.id, name: c.name, foundational: c.foundational }));
  const runs: Run[] = args.faculty.map(f => {
    const { required } = readRequired(readFileSync(f.required, 'utf8'), comps);
    const { links, warnings } = readLinks(readFileSync(f.links, 'utf8'), comps, extract.path);
    const input = buildInput(extract, required, links);
    return { name: f.name, input, analysis: analyze(input), warnings };
  });
  writeFileSync(args.out, renderReport(extract, runs, { synthetic: args.synthetic }));
  const n = runs.map(r => `${r.name}: ${r.analysis.shortfalls.length} shortfalls`).join('; ');
  console.log(`wrote ${args.out} (${n})`);
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
