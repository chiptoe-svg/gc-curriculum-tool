# GC Page Design System — v1.1 (Nov 2026)

**For any Claude instance or agent that builds web pages for Clemson Graphic Communications.**
Follow this file exactly. It covers two page types that share one frame:

- **Paper:** a long read, such as a position paper, report, brief or findings write-up.
- **Tool:** an interactive page, such as a map, review or labeling tool, dashboard or explorer.

A reader moving between a paper and a tool should feel they never left the site.

---

## 1. Principles

1. **Calm and roomy.** Off-white page, white panels, hairline rules, generous space. Few borders and no heavy shadows.
2. **Three voices of type.** A serif (Newsreader) for titles and headings, a sans (IBM Plex Sans) for reading and controls, and a mono (IBM Plex Mono) for labels, numbers and codes.
3. **Purple means you can act.** Links, selected controls and focus rings are Clemson Regalia purple `#522D80`.
4. **Orange marks, never acts.** Burnt orange `#C24F00` is for section numbers, eyebrows and numbered-point numerals. Clemson orange `#F56600` appears only as small dots: the brand dot and the hero dot. Orange is never a button or a link.
5. **Other colors mean status.** The five cue colors are reserved for status, and each has its own shape so it reads without color.
6. **Amounts use one purple ramp.** Anything measured, such as depth, level or count intensity, goes light to dark on the D0–D5 ramp.
7. **Papers and tools link to each other.** Every paper ends with a card for its tool, and every tool ends with a card for its paper.
8. **No filler.** Use no invented numbers or lorem ipsum. Write unknowns as `[PLACEHOLDER]`.

---

## 2. Tokens

| Token | Value | Use |
|---|---|---|
| `--page` | `#FBFBFA` | Page background |
| `--panel` | `#FFFFFF` | Tool step panels, cross-link cards, inputs |
| `--inset` | `#F3F2F6` | Detail panes inside panels, small badges |
| `--rule` | `#DCD9E2` | Header and footer rules, table and list dividers, control borders |
| `--rule-soft` | `#E6E3EC` | Panel borders, hero rings |
| `--ink` | `#1D1B22` | Text |
| `--ink-2` | `#46424F` | Lede text |
| `--muted` | `#5D5966` | Secondary text, meta, labels (passes 4.5:1 on `--page`) |
| `--purple` | `#522D80` | Links, selected controls, focus |
| `--purple-dark` | `#3A1F5C` | Link hover, text on purple-soft |
| `--purple-soft` | `#ECE6F4` | Note boxes, selected code buttons |
| `--orange` | `#C24F00` | Eyebrows, section numbers, numerals |
| `--mark` | `#F56600` | Brand dot and hero dot only |

### Status cues

| Cue | Class | Text | Background | Marker | Shape | Means |
|---|---|---|---|---|---|---|
| Needs your input | `cue-input` | `#8A5A00` | `#FFF4DB` | `#B57600` | ▲ triangle | Waiting on the reader; also a gap someone should fill |
| Ready to read | `cue-read` | `#522D80` | `#ECE6F4` | `#522D80` | ○ ring | Finished, informational |
| Draft | `cue-draft` | `#5D5966` | `#EFEEF2` | `#5D5966` | ◌ dashed ring | In progress, provisional, for discussion |
| Done | `cue-done` | `#2F6B3A` | `#E4F0E6` | `#2F6B3A` | ● dot | Approved, complete, passing |
| Problem | `cue-issue` | `#9B2C2C` | `#F9E3E3` | `#9B2C2C` | ◆ diamond | Error, blocked, wrong |

Labels may be near-synonyms ("Draft for discussion", "Weights provisional", "Not built yet"), but the meaning must match the cue.

### Amount ramp (purple, D0–D5)

| Step | Background | Text |
|---|---|---|
| D0 | `#F1EDF7` | `#522D80` |
| D1 | `#E0D6EE` | `#3F2470` |
| D2 | `#C7B5E0` | `#2B1752` |
| D3 | `#7A5BAE` | `#FFFFFF` |
| D4 | `#5E3F94` | `#FFFFFF` |
| D5 | `#3F2470` | `#FFFFFF` |

Always print the step's label (D2) inside the swatch. For charts, use this ramp for sequential data. For categories, use `--ink`, `--purple`, `--orange` and `--muted` before adding anything new.

### Type

Load: `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400..700&display=swap`

| Role | Font | Size / line height | Notes |
|---|---|---|---|
| Paper title | Newsreader 600 | 64 / 1.04 | −0.02em; 40 px on phones |
| Tool title | Newsreader 600 | 52 / 1.05 | −0.02em; 36 px on phones |
| Section heading (paper) | Newsreader 600 | 40 / 1.1 | Mono orange number above it |
| Panel heading (tool), short-version heading | Newsreader 600 | 28–30 | Mono orange step number above it |
| Pull quote | Newsreader 500 | 30 / 1.3 | Short orange bar above it; at most two per paper |
| Lede | Plex Sans 400 | 21 paper / 19 tool, 1.5 | `--ink-2`, max 760 px |
| Body | Plex Sans 400 | 17 / 1.65 paper; 16 / 1.6 tool | Max 720 px line length |
| UI text, buttons | Plex Sans 500 | 14–15 | |
| Meta | Plex Sans 400 | 13–14 | `--muted` |
| Eyebrow, labels, codes | Plex Mono 500 | 11–13, uppercase for labels, letter-spacing 0.08–0.1em | Course codes stay in their normal case |

### Space and shape

- Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 56 · 72 · 96 px.
- Frame: content max **1120 px**, 32 px side padding (20 on phones).
- Paper: contents column 200–240 px, article max 720 px, 72 px gap, and 56 px between article blocks.
- Long papers (more than about six sections) add `paper--long`. On screens 1024 px and wider, the contents column then stays in view while the reader scrolls, and the section in view is marked. On narrower screens it sits above the article like any other contents list.
- Tool: step panels 32 px padding, 24 px apart.
- Corners: 10 inputs and code buttons · 16 note boxes, cards and detail panes · 20 step panels · pill (999) for choice buttons, segmented controls and cues.
- Shadows only on hover (cross-link cards): `0 12px 32px rgba(29,27,34,.08)` with a 2 px lift.
- Decorative shapes appear **in the hero only**: two hairline rings (`--rule-soft`, `#EEECF2`) off the top right, plus one 10 px `--mark` dot. They are `aria-hidden` and hidden on phones.

---

## 3. Drop-in CSS

Paste this into every page **unchanged**, then build with these classes.

```css
:root{
  --page:#FBFBFA;--panel:#FFFFFF;--inset:#F3F2F6;--rule:#DCD9E2;--rule-soft:#E6E3EC;
  --ink:#1D1B22;--ink-2:#46424F;--muted:#5D5966;
  --purple:#522D80;--purple-dark:#3A1F5C;--purple-soft:#ECE6F4;--orange:#C24F00;--mark:#F56600;
  --serif:Newsreader,"Iowan Old Style",Georgia,serif;
  --sans:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
  --max:1120px;--pad:32px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:400 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--purple);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--purple-dark)}
:focus-visible{outline:2px solid var(--purple);outline-offset:2px;border-radius:6px}
h1,h2,h3{font-family:var(--serif);font-weight:600;margin:0}
p{margin:0}

/* ---------- Frame (both page types) ---------- */
.wrap{max-width:var(--max);margin:0 auto;padding-inline:var(--pad)}
.site-header{border-bottom:1px solid var(--rule)}
.site-header .wrap{min-height:60px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 24px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase}
.brand::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--mark)}
.nav{display:flex;flex-wrap:wrap;gap:28px;font-size:14px}
.nav a{color:var(--muted);text-decoration:none}
.nav a:hover,.nav a[aria-current="page"]{color:var(--ink)}
.nav a[aria-current="page"]{font-weight:600}
.site-footer{border-top:1px solid var(--rule)}
.site-footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px;padding-block:24px 32px;font:400 12px var(--mono);letter-spacing:.02em;color:var(--muted)}

/* ---------- Hero ---------- */
.hero{position:relative;overflow:hidden}
.hero .wrap{position:relative;display:flex;flex-direction:column;gap:18px;padding-block:96px 64px}
.hero--tool .wrap{padding-block:80px 48px;gap:16px}
.eyebrow{font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--orange)}
.title-paper{font-size:64px;line-height:1.04;letter-spacing:-.02em;max-width:860px}
.title-tool{font-size:52px;line-height:1.05;letter-spacing:-.02em}
.lede{font-size:21px;line-height:1.5;color:var(--ink-2);max-width:760px}
.hero--tool .lede{font-size:19px;max-width:720px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px 32px;font-size:14px;color:var(--muted)}
.meta-row strong{color:var(--ink);font-weight:600}
.ring{position:absolute;border-radius:50%;pointer-events:none}
.ring-1{right:-180px;top:-260px;width:620px;height:620px;border:1px solid var(--rule-soft)}
.ring-2{right:-320px;top:-400px;width:900px;height:900px;border:1px solid #EEECF2}
.ring-dot{position:absolute;right:152px;top:48px;width:10px;height:10px;border-radius:50%;background:var(--mark)}

/* ---------- Paper ---------- */
.paper{display:flex;flex-wrap:wrap;gap:48px 72px;align-items:flex-start;padding-bottom:96px}
.toc{flex:1 1 200px;max-width:240px;border-top:1px solid var(--rule);padding-top:16px;font-size:14px}
.toc a{display:flex;gap:12px;padding:6px 0;line-height:1.35;color:var(--muted);text-decoration:none}
.toc a:hover{color:var(--ink)}
.toc .n{font:500 13px var(--mono);color:var(--orange);width:14px;flex:none}
.toc a[aria-current="true"]{color:var(--ink);font-weight:600}
@media (min-width:1024px){.paper--long .toc{position:sticky;top:24px;max-height:calc(100vh - 48px);overflow-y:auto}}
.article{flex:999 1 560px;min-width:0;max-width:720px;display:flex;flex-direction:column;gap:56px;font-size:17px;line-height:1.65}
.article section{display:flex;flex-direction:column;gap:20px}
.sec-num{font:500 13px var(--mono);color:var(--orange)}
.sec-title{font-size:40px;line-height:1.1;letter-spacing:-.015em}
.points h2{font-size:30px;margin-bottom:8px}
.point{display:flex;gap:24px;padding:20px 0;border-top:1px solid var(--rule)}
.point .num{font:500 40px/1 var(--serif);color:var(--orange);width:28px;flex:none}
.point strong{display:block;font-size:18px;font-weight:600;line-height:1.45}
.point span{display:block;color:var(--muted);font-size:16px;margin-top:6px}
.pull{margin:16px 0;display:flex;flex-direction:column;gap:12px}
.pull::before{content:"";width:40px;height:3px;border-radius:2px;background:var(--mark)}
.pull blockquote{margin:0;font:500 30px/1.3 var(--serif);letter-spacing:-.01em}

/* ---------- Tool ---------- */
.tool{display:flex;flex-direction:column;gap:24px;padding-bottom:96px}
.step{background:var(--panel);border:1px solid var(--rule-soft);border-radius:20px;padding:32px;display:flex;flex-direction:column;gap:20px}
.step-num{font:500 12px var(--mono);color:var(--orange)}
.step h2{font-size:28px;letter-spacing:-.01em}
.pane{background:#F7F6F9;border-radius:16px;padding:28px;display:flex;flex-direction:column;gap:16px}
.split{display:flex;flex-wrap:wrap;gap:32px}
.split > :first-child{flex:1 1 300px;max-width:380px}
.split > :last-child{flex:999 1 420px;min-width:0}
.label{font:500 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}

/* ---------- Controls ---------- */
.pill{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--rule);background:var(--panel);color:var(--ink);font:500 15px var(--sans);cursor:pointer}
.pill:hover{border-color:#B9B4C4}
.pill[aria-pressed="true"]{background:var(--purple);border-color:var(--purple);color:#fff}
.seg-group{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:#ECEAF0}
.seg{min-height:36px;padding:0 14px;border-radius:999px;border:0;background:transparent;color:var(--muted);font:500 14px var(--sans);cursor:pointer}
.seg[aria-pressed="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(29,27,34,.12)}
.code-btn{min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--rule);background:var(--panel);color:var(--ink);font:500 13px var(--mono);cursor:pointer}
.code-btn[aria-pressed="true"]{border:2px solid var(--purple);padding:0 11px;background:var(--purple-soft);color:var(--purple-dark)}
.btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 20px;border-radius:999px;border:0;background:var(--purple);color:#fff;font:500 15px var(--sans);text-decoration:none;cursor:pointer}
.btn:hover{background:var(--purple-dark);color:#fff}
.link-arrow{display:inline-flex;align-items:center;gap:6px;min-height:44px;font-weight:500;font-size:15px}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:14px;font-weight:600}
.field input,.field select,.field textarea{min-height:44px;padding:0 14px;border:1px solid var(--rule);border-radius:10px;background:#fff;font:400 15px var(--sans);color:var(--ink)}
.field textarea{padding:10px 14px;min-height:96px}

/* ---------- Status cues ---------- */
.cue{display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 10px;border-radius:999px;font:500 12.5px var(--sans);white-space:nowrap}
.cue::before{content:"";width:8px;height:8px;flex:none}
.cue-input{background:#FFF4DB;color:#8A5A00}.cue-input::before{background:#B57600;clip-path:polygon(50% 0,100% 100%,0 100%)}
.cue-read{background:#ECE6F4;color:#522D80}.cue-read::before{border:1.5px solid #522D80;border-radius:50%;width:6px;height:6px}
.cue-draft{background:#EFEEF2;color:#5D5966}.cue-draft::before{border:1.5px dashed #5D5966;border-radius:50%;width:6px;height:6px}
.cue-done{background:#E4F0E6;color:#2F6B3A}.cue-done::before{background:#2F6B3A;border-radius:50%}
.cue-issue{background:#F9E3E3;color:#9B2C2C}.cue-issue::before{background:#9B2C2C;transform:rotate(45deg);width:7px;height:7px}

/* ---------- Amount ramp ---------- */
.lv{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;border-radius:5px;font:600 11px var(--mono)}
.d0{background:#F1EDF7;color:#522D80}.d1{background:#E0D6EE;color:#3F2470}.d2{background:#C7B5E0;color:#2B1752}
.d3{background:#7A5BAE;color:#fff}.d4{background:#5E3F94;color:#fff}.d5{background:#3F2470;color:#fff}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 3px 0 9px;border-radius:8px;background:#fff;border:1px solid var(--rule);font:500 12px var(--mono);white-space:nowrap}
.badge{font:500 11.5px var(--mono);color:var(--muted);background:var(--inset);border-radius:5px;padding:2px 6px}

/* ---------- Boxes and cards ---------- */
.note{display:flex;gap:16px;background:var(--purple-soft);border-radius:16px;padding:22px 24px;font-size:15.5px;color:#2E2A36}
.note svg{flex:none;margin-top:3px}
.note strong{color:var(--ink);font-weight:600}
.xlink{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;background:var(--panel);border:1px solid var(--rule);border-radius:16px;padding:22px 24px;text-decoration:none;color:var(--ink);transition:box-shadow .2s,transform .2s}
.xlink:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(29,27,34,.08);color:var(--ink)}
.xlink .t{display:block;font:600 22px var(--serif)}
.xlink .d{display:block;font-size:15px;color:var(--muted)}

/* ---------- Tables and lists ---------- */
.table-box{overflow-x:auto;border-top:1px solid var(--rule)}
table{width:100%;min-width:720px;border-collapse:collapse;font-size:15px}
th{text-align:left;padding:12px 16px 12px 0;font:500 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
td{padding:14px 16px 14px 0;border-top:1px solid #EEECF2;vertical-align:top}
td.num,th.num{text-align:right;font-family:var(--mono)}
.empty{color:#B9B4C4}

/* ---------- Phone ---------- */
@media (max-width:640px){
  :root{--pad:20px}
  .title-paper{font-size:40px}.title-tool{font-size:36px}.sec-title{font-size:30px}
  .lede{font-size:18px}
  .hero .wrap{padding-block:56px 40px}
  .ring,.ring-dot{display:none}
  .step{padding:22px}
  .toc{max-width:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
```

---

## 4. Shared frame

The header and footer are identical on every page. Change only `aria-current`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>[Page title] — Graphic Communications, Clemson</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400..700&display=swap">
<style>/* section 3 CSS */</style>
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="[home]">Graphic Communications · Clemson University</a>
    <nav class="nav" aria-label="Main">
      <a href="[papers]">Papers</a>
      <a href="[tools]">Tools</a>
      <a href="[reviews]">Reviews</a>
    </nav>
  </div>
</header>

<!-- hero + main content -->

<footer class="site-footer">
  <div class="wrap"><span>Department of Graphic Communications · Clemson University</span><span>Updated [Mon YYYY] · [contact]</span></div>
</footer>
</body>
</html>
```

Put `aria-current="page"` on the nav link for the page's section.

---

## 5. Paper page

Order: **hero → note box (optional) → short version → numbered sections → cross-link to tool → sources.**

```html
<section class="hero">
  <div class="ring ring-1" aria-hidden="true"></div><div class="ring ring-2" aria-hidden="true"></div><div class="ring-dot" aria-hidden="true"></div>
  <div class="wrap">
    <span class="eyebrow">Paper · [series, n of N]</span>
    <h1 class="title-paper">[Title]</h1>
    <p class="lede">[Two sentences: what this paper argues and for whom.]</p>
    <div class="meta-row">
      <span><strong>For</strong> [audience]</span>
      <span><strong>Evidence as of</strong> [Month YYYY]</span>
      <span class="cue cue-draft">Draft for discussion</span>
    </div>
  </div>
</section>

<div class="wrap paper">
  <nav class="toc" aria-label="Contents">
    <span class="label">Contents</span>
    <a href="#s1"><span class="n">1</span><span>[Section]</span></a>
    <!-- Appendix = A, Terms = T, Sources = last number -->
  </nav>

  <article class="article">
    <aside class="note">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#522D80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>
      <p><strong>[Lead-in.]</strong> [Context and links to related papers.]</p>
    </aside>

    <section class="points">
      <h2>The short version</h2>
      <div class="point"><span class="num">1</span><div><strong>[Bold claim in one sentence.]</strong><span>[One sentence of support.]</span></div></div>
      <!-- 3–5 points -->
    </section>

    <section id="s1">
      <div><span class="sec-num">01</span><h2 class="sec-title">[Section title]</h2></div>
      <p>[Body…]</p>
      <figure class="pull"><blockquote>[One line worth remembering.]</blockquote></figure>
    </section>

    <a class="xlink" href="[tool url]">
      <span><span class="label">Explore the data · Tool</span><span class="t">[Tool name]</span><span class="d">[What it lets you see.]</span></span>
      <span class="link-arrow">Open the tool →</span>
    </a>
  </article>
</div>
```

Paper rules:
- The short version has 3–5 points. Each has a bold one-sentence lead and **one** supporting sentence. Don't let it become a block of paragraphs.
- Sections are numbered `01`, `02`… in mono orange. Each one starts with its point, not with background.
- Use at most two pull quotes per paper. Figures and charts sit inside the 720 px column with a mono label above and a one-line caption below.
- Long papers (more than about 5,000 words) still get the short version, and can add a "What isn't known yet" section near the end.

---

## 6. Tool page

Order: **hero (tool variant) → numbered step panels → footnote on data → cross-link to paper.**

```html
<section class="hero hero--tool">
  <div class="ring ring-1" aria-hidden="true"></div><div class="ring ring-2" aria-hidden="true"></div><div class="ring-dot" aria-hidden="true"></div>
  <div class="wrap">
    <span class="eyebrow">Tool · [area]</span>
    <h1 class="title-tool">[Tool name]</h1>
    <p class="lede">[One sentence: what you do here and what you get.]</p>
    <div class="meta-row"><span>Built [date] from [source]</span><span class="cue cue-draft">[Provisional thing]</span></div>
  </div>
</section>

<main class="wrap tool">
  <section class="step" aria-labelledby="st1">
    <div><span class="step-num">01</span><h2 id="st1">[Verb-first step: Choose a career]</h2></div>
    <div role="group" aria-label="[Thing]" style="display:flex;flex-wrap:wrap;gap:10px">
      <button type="button" class="pill" aria-pressed="true">[Option]</button>
      <button type="button" class="pill" aria-pressed="false">[Option]</button>
    </div>
    <p style="color:var(--ink-2);max-width:780px">[Description of the current choice, 16 px.]</p>
  </section>

  <section class="step" aria-labelledby="st2">
    <div><span class="step-num">02</span><h2 id="st2">[Pick an item]</h2></div>
    <div class="split">
      <div><!-- list or code buttons, grouped under .label headings --></div>
      <div class="pane">
        <span class="label">[CODE · CONTEXT]</span>
        <h3 style="font-size:28px">[Item name]</h3>
        <div class="seg-group" role="group" aria-label="View">
          <button type="button" class="seg" aria-pressed="true">[View A]</button>
          <button type="button" class="seg" aria-pressed="false">[View B]</button>
        </div>
        <!-- detail rows: text left, mono .badge values right, rows split by 1px rules -->
      </div>
    </div>
  </section>

  <section class="step" aria-labelledby="st3">
    <div><span class="step-num">03</span><h2 id="st3">[See the result]</h2></div>
    <div class="table-box"><!-- table or grid; amounts as .chip with .lv.dN; gaps as .cue-input; empty cells as <span class="empty">—</span> --></div>
    <p class="meta">[Where the data comes from and what is provisional.]</p>
  </section>

  <a class="xlink" href="[paper url]">
    <span><span class="label">Read the argument · Paper</span><span class="t">[Paper title]</span><span class="d">[Why this tool exists.]</span></span>
    <span class="link-arrow">Read the paper →</span>
  </a>
</main>
```

Tool rules:
- **Steps are numbered and start with a verb** ("Choose a career", "Pick a course", "Label each pair"). One decision per panel.
- **Selection is always purple:** filled pill for options, purple-bordered code button for items, white raised segment for views. Set `aria-pressed` and use real `<button>`s.
- **Never cut off names.** Show codes in buttons and the full name in the detail pane, or let text wrap.
- **Amounts** use the D0–D5 ramp with the label printed. **Gaps** use `cue-input`. **Empty cells** show a light em dash.
- **Text is at least 14 px**, including diagram labels. If a diagram can't fit readable labels, offer a table view.
- **Labeling and review tools:** each item is a row or card with a status cue. Picking a label changes it from `cue-input` to `cue-done`, or to `cue-issue` if flagged. Show progress as "[n] of [N] labeled" in the hero meta row.
- **Charts:** neutral marks in `--ink` or `--muted`, highlight in `--purple`, sequential data on the ramp. Label values directly, keep gridlines in `#EEECF2`, and use no gradients or 3-D.
- Wide tables and grids go in `.table-box` so they scroll sideways on phones.

---

## 7. Bringing existing pages into line

- **Papers already in the Newsreader + Plex style** (e.g. *Design and Production Systems*): swap in section 3's CSS, then make the short version one bold lead plus one supporting sentence per point. Add the tool cross-link and the hero rings.
- **Tools in other styles** (e.g. *GC Curriculum Map*, currently in Fraunces, Source Sans and green): replace the fonts and the green `#1F6F5C` with the purple roles, and make the career description 16 px with a 780 px max width. Replace truncated course names with code buttons plus a detail pane, raise diagram labels to at least 14 px, and add the numbered step headings.
- **Review and labeling pages:** wrap them in the tool layout, show item status with cues and add a progress count to the hero.

---

## 8. Don'ts

- No new fonts and no new colors. If something seems to need a color, it's probably a status or an amount, so map it.
- Orange is never used for links, buttons or body text.
- No gradients, glows, dark mode by default, emoji, or colored left-border cards.
- No decorative shapes outside the hero.
- Color is never the only signal: cues keep their shape and words, and ramp swatches keep their label.
- No dark or full-height menus. The only sticky element allowed is the contents column of a long paper (`paper--long`) on wide screens. Contents and nav wrap above the content on phones.
- No lorem ipsum or invented figures.

## 9. Before handing a page back, check

- [ ] Section 3 CSS pasted unchanged; no stray hex values
- [ ] Header and footer match section 4; the right nav item has `aria-current="page"`
- [ ] Paper: eyebrow, title, lede, meta row with a cue, a short version of 3–5 points, numbered sections, a tool cross-link
- [ ] Tool: numbered verb-first steps, purple selection with `aria-pressed`, no truncated names, a data-source note, a paper cross-link
- [ ] Every status uses a `.cue`, and every amount uses the `.lv` ramp with its label
- [ ] Text contrast at least 4.5:1, and no text under 12 px (14 px in diagrams)
- [ ] Works at 390 px wide: nav wraps, contents stack above the article, panels stack, tables scroll
- [ ] Controls are real `<button>`, `<a href>` and `<input>` elements with labels; decorative SVGs are `aria-hidden="true"`
