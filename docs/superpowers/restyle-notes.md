# Restyle recipe: docs pages to the GC design system (v1.1)

Written from the pilot (Nov 2026): `docs/three-act-deep-dive.html` (paper, `paper--long`) and
`docs/curriculum-map.html` (tool, generated from `scripts/docs/curriculum-map.template.html`).
Read `docs/GC-DESIGN-SYSTEM.md` first; this file covers only what the guide leaves open.

## Order of work
1. Paste guide §3 CSS **unchanged** as the first `<style>`. Do it mechanically (copy lines from the
   guide file) so no character drifts. Page CSS goes in a second `<style>` using only tokens,
   cue colors and ramp values.
2. Transform the old body **by script, not by retyping** (regex over `git show dev:<page>`), so the
   prose bytes never pass through your hands. Hand-write only the frame, hero, toc and cards.
3. Run `node scripts/docs/check-restyle-text.mjs docs/<page>.html` after every build.
4. Check at 1440 and 390 wide (Playwright cannot open `file:`; serve `docs/` on a free loopback port
   from `~/.dev-ports.yaml`, kill it when done). Screenshots must be saved under the repo, then moved.

## The guard is order-sensitive (the big pitfall)
The guard diffs visible words **in document order**. Moving a block of words to another place in
the DOM counts as removed + added and FAILS. Consequences:
- **Old left rail → `.toc`.** The rail came first in the old DOM, so the toc must also come before
  the hero in the new DOM. Put the hero *inside* `.paper`, after the toc, and lift it visually:
  `.paper > .hero{order:-1;flex:1 1 100%;margin-inline:calc(-1 * var(--pad))}`.
  Reading order (nav, then hero, then article) stays sensible; the hero has no focusable items.
- **Every rail word survives**, including group labels ("Part I — Consistent with"), the rail header
  ("Clemson · Graphic Communications / GC Curriculum Tool / Research Deep Dive" → `.toc-kicker`),
  "See also" links (`a.out`, no number) and the rail footer link.
- Old section numbers stay as written (`§ 1` in `.sec-num`), not `01`.
- New step headings must not replace old headings. Tool: the old `h2` becomes an `h3.sub-h` under
  a new verb-first step `h2` ("Trace the competencies" above "Courses → competencies → career").
- Words inside `<script>`, `<style>`, `<svg>` and `<title>` are not checked, so JS-rendered text is
  free to change; static HTML text is not.
- Do **not** add a short version, a "Contents" label, a References toc entry or a status cue unless
  those words already exist. The guide's short version adds sentences; skip it (rule: words do not change).

## Class mapping used
| Old | New |
|---|---|
| `#rail` aside, `.nav-link`, `.nav-group-label` | `nav.toc#rail` (keep the id), links `<a><span class="n">N</span><span>…</span></a>`, group labels `span.label` |
| `.doc-head` / `.doc-eyebrow` / `.doc-title` / `.doc-subtitle` / `.doc-meta` | `section.hero` / `.eyebrow` / `h1.title-paper` / `p.lede` / `.meta-row` (`<span><strong>Date</strong> …</span>`) |
| `h2 > span.num` + text | `<div><span class="sec-num">§ 1</span><h2 class="sec-title">…</h2></div>` |
| unnumbered "Part I — …" `h2` with inline style | `<div class="part"><h2 class="part-title">…</h2>(intro p)</div>` |
| `.callout`, `.callout.note`, `.callout-title` | `aside.note` + guide book SVG + `<div><strong>Title</strong><p>…</p></div>` |
| `.doc-foot` footer | `p.doc-foot` (last block of the article); site footer is the §4 frame |
| tool `.box` | `section.step` with `.step-num` + verb-first `h2` |
| tool `.chip` career buttons | `button.pill[aria-pressed]` |
| tool `.toggle` | `.seg-group > button.seg[aria-pressed]` |
| truncated SVG course labels | codes only in the diagram + `button.code-btn` grouped by `.label` "Year N" + `.pane` detail |
| `.kud` "K2 U1 D3" text | three `.lv.dN` swatches labelled K2 U1 D3 (each on its own ramp step) |
| `.dot` (code + D level) | `.chip` with code + `.lv.dN` |
| lanes div grid | real `<table>` inside `.table-box` |
| "not built in any captured course" | `.cue.cue-input` (a gap) |
| `.note` small muted text (tool) | `p.meta` (define `.meta{font-size:14px;color:var(--muted)}`; the guide uses it but does not define it) |
| `sup.nv` | keep markup; restyle `sup.nv{font:500 .72em var(--mono);color:var(--muted)}` |

## Frame (verbatim; change only `aria-current`)
```html
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html">Graphic Communications · Clemson University</a>
    <nav class="nav" aria-label="Main">
      <a href="index.html#papers" aria-current="page">Papers</a>
      <a href="index.html#tools">Tools</a>
      <a href="index.html#reviews">Reviews</a>
    </nav>
  </div>
</header>
…
<footer class="site-footer">
  <div class="wrap"><span>Department of Graphic Communications · Clemson University</span><span>Updated Nov 2026</span></div>
</footer>
```
Add a contact to the footer only if the old page already showed one. `<title>`: `[Title] — Graphic Communications, Clemson`.

## Toc script (verbatim, before `</body>`)
```html
<script>
/* Marks the contents link of the section in view. Without JS the contents column still works as plain links. */
(() => {
  const toc = document.querySelector('.toc');
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const secs = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if (!('IntersectionObserver' in window) || !secs.length) return;
  const inView = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? inView.add(e.target.id) : inView.delete(e.target.id)));
    const cur = secs.find((s) => inView.has(s.id));
    if (!cur) return;
    const a = byId.get(cur.id);
    links.forEach((l) => l.removeAttribute('aria-current'));
    a.setAttribute('aria-current', 'true');
    // When the sticky column is taller than the screen, keep the marked link visible inside it.
    if (toc.scrollHeight > toc.clientHeight && (a.offsetTop < toc.scrollTop || a.offsetTop + a.offsetHeight > toc.scrollTop + toc.clientHeight)) {
      toc.scrollTop = a.offsetTop - toc.clientHeight / 2;
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  secs.forEach((s) => io.observe(s));
})();
</script>
```
Also add `.article section{scroll-margin-top:24px}`.

## Tables, lists, tags
- Article lists: `.article ul,.article ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:10px}`.
  `h3` inside sections: 24px. The article's flex `gap` replaces old `p` margins (guide sets `p{margin:0}`).
- Wide tables: wrap in `.table-box`. Long reference strings: `ol.refs{overflow-wrap:anywhere}`.
- Categorical colors (e.g. per-Act) map to `--ink`, `--purple`, `--orange`, `--muted`; statuses to
  a `.cue-*` by meaning, never by old color; anything measured to `.lv.dN` with the label printed.
- SVG diagrams: set `width`/`height` attributes equal to the viewBox so 14px means 14px (a scaled
  viewBox shrinks labels), put the SVG in `.table-box` for phones, wrap names over lines instead of
  truncating, and offer a Table view. Ramp fills in SVG need `rect`/`text` fill rules with the ramp
  hex values (`.lv` sets `background`, which SVG ignores).

## Cross-link cards
Paper → tool: `label` "Explore the data · Tool". Tool → paper: "Read the argument · Paper". The
one-sentence `.d` may be new text; borrow it from the target's own lede or index card where possible.

## Pitfalls hit
- `scripts/docs/check-citations.mjs` only finds the reference list if the tag is exactly
  `<section id="references">`. The old three-act page had an inline `style` on it, so its references
  were never checked; the restyle removed the style and the check now runs (and passes). Keep that
  exact tag; never put attributes after the id.
- In a git worktree, `docs/references/_pdfs/` is empty (git-ignored), so check-citations reports every
  held source as missing. Link the main checkout's files in temporarily (file by file; the folder
  exists with a README), run, then remove only the links you made. Compare against `dev`'s copy the same way.
- Generated pages: edit the template, then rebuild by injecting the JSON already embedded in the
  output (`const DATA = …;`) with a function replacement (`.replace(ph, () => json)`; a string
  replacement would interpret `$&`). Assert the extracted JSON is byte-identical before writing.
- The old map had a dark-mode block; the guide has no dark mode, so it was dropped.
- The guide's brand line wraps to two lines at 390px; that is the guide's frame, left as is.
