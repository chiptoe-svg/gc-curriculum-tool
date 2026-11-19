#!/usr/bin/env python3
"""Regenerate docs/graduate-outcome-validation-readable.html from the source doc.

Text-only twin for listen-aloud: keeps h1-h3, paragraphs and list items; drops
tables, the stats block and caption, the series nav, the closing footer lines,
scripts and styles. Output uses the GC page design system (guide 3 CSS, simple
paper page: header, hero, article).
Run after every edit to the source:  python3 scripts/docs/make-readable.py
"""
import html, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/graduate-outcome-validation.html"
OUT = ROOT / "docs/graduate-outcome-validation-readable.html"
SKIP_TAGS = {"table", "nav", "style", "script", "head"}
SKIP_CLASSES = {"stats", "stats-caption", "doc-foot"}
KEEP = {"h1", "h2", "h3", "p", "li"}
# Styled divs that read as headings in the page (card titles). Section heads are
# handled separately: span.sec-num ("01") + span.label ("Background") are read as
# one h2 "Section 1 - Background", as before the restyle.
CLASS_AS = {"card-header": "h3"}
VOID = {"br", "img", "meta", "link", "hr", "input"}

class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, skipping) for open elements
        self.skip = 0
        self.cur = None          # (tag, [text])
        self.blocks = []
        self.in_ul = False
        self.num = None
    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if tag == "br" and self.cur: self.cur[1].append(" ")
            return
        cls = set((dict(attrs).get("class") or "").split())
        skipping = tag in SKIP_TAGS or bool(cls & SKIP_CLASSES)
        self.stack.append((tag, skipping))
        if skipping: self.skip += 1
        if self.skip: return
        if tag == "ul": self.blocks.append(("ul-open", ""))
        if self.cur is None:
            as_tag = next((CLASS_AS[c] for c in cls if c in CLASS_AS), None)
            if "sec-num" in cls:
                self.cur = ("sec-num", [], tag)
            elif "label" in cls and self.num is not None:
                self.cur = ("h2", [f"Section {self.num} \u2014 "], tag)
                self.num = None
            elif as_tag:
                self.cur = (as_tag, [], tag)
            elif tag in KEEP:
                self.cur = (tag, [], tag)
    def handle_endtag(self, tag):
        if tag in VOID: return
        while self.stack:
            t, skipping = self.stack.pop()
            if skipping: self.skip -= 1
            if t == tag: break
        if self.skip: return
        if self.cur and tag == self.cur[2]:
            text = re.sub(r"\s+", " ", "".join(self.cur[1])).strip()
            if self.cur[0] == "sec-num":
                self.num = int(text)
            elif text: self.blocks.append((self.cur[0], text))
            self.cur = None
        if tag == "ul": self.blocks.append(("ul-close", ""))
    def handle_data(self, data):
        if not self.skip and self.cur is not None:
            self.cur[1].append(data)

r = Reader(); r.feed(SRC.read_text())
frame_css = re.search(r"## 3\. Drop-in CSS.*?```css\n(.*?)\n```", (ROOT / "docs/GC-DESIGN-SYSTEM.md").read_text(), re.S).group(1)
page_css = """
.reader-note{order:5;font-size:14px;color:var(--muted);max-width:760px}
.reader-note code{font:400 13px var(--mono)}
.article.flat{gap:16px}
.article.flat h2{font-size:32px;line-height:1.15;margin-top:32px}
.article.flat h2.kicker{font:500 13px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--orange);margin-top:40px;margin-bottom:-8px}
.article.flat h3{font-size:24px;line-height:1.25;margin-top:12px}
.article ul{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:10px}
"""
note = ('<p class="reader-note">Plain-text reading version &mdash; data tables, the stats bar, and the document-map navigation are omitted '
        'so screen-reader / listen-aloud runs straight through without stopping. Generated from '
        '<a href="./graduate-outcome-validation.html">the full study page</a> by <code>scripts/docs/make-readable.py</code>.</p>')
# Hero: first h1 and the paragraph after it (the lede). Everything else is the article.
hero_title = hero_lede = ""
rest = []
for tag, text in r.blocks:
    if tag == "h1" and not hero_title: hero_title = text
    elif tag == "p" and hero_title and not hero_lede: hero_lede = text
    else: rest.append((tag, text))
body = []
for tag, text in rest:
    if tag == "ul-open": body.append("<ul>")
    elif tag == "ul-close": body.append("</ul>")
    elif tag == "li": body.append(f"  <li>{html.escape(text)}</li>")
    elif tag == "h2" and text.startswith("Section "): body.append(f'<h2 class="kicker">{html.escape(text)}</h2>')
    else: body.append(f"<{tag}>{html.escape(text)}</{tag}>")
out = re.sub(r"<ul>\s*</ul>\n?", "", "\n".join(body))  # drop empty lists
doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Graduate Outcome Study \u2014 Reading Version (text only) \u2014 Graphic Communications, Clemson</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400..700&display=swap">
<style>
{frame_css}
</style>
<style>{page_css}</style>
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html">Graphic Communications \u00b7 Clemson University</a>
    <nav class="nav" aria-label="Main">
      <a href="index.html#papers" aria-current="page">Papers</a>
      <a href="index.html#tools">Tools</a>
      <a href="index.html#reviews">Reviews</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="ring ring-1" aria-hidden="true"></div><div class="ring ring-2" aria-hidden="true"></div><div class="ring-dot" aria-hidden="true"></div>
  <div class="wrap">
    <span class="eyebrow">Paper \u00b7 Reading version</span>
    {note}
    <h1 class="title-paper">{html.escape(hero_title)}</h1>
    <p class="lede">{html.escape(hero_lede)}</p>
  </div>
</section>

<div class="wrap paper">
  <article class="article flat">
{out}
  </article>
</div>

<footer class="site-footer">
  <div class="wrap"><span>Department of Graphic Communications \u00b7 Clemson University</span><span>Updated Nov 2026</span></div>
</footer>
</body>
</html>
"""
OUT.write_text(doc)
print(f"wrote {OUT.relative_to(ROOT)}: {len(r.blocks)} blocks")
