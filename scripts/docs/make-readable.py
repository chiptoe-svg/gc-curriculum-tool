#!/usr/bin/env python3
"""Regenerate docs/graduate-outcome-validation-readable.html from the source doc.

Text-only twin for listen-aloud: keeps h1-h3, paragraphs and list items; drops
tables, the stats bar and caption, the doc-map nav, scripts and styles.
Run after every edit to the source:  python3 scripts/docs/make-readable.py
"""
import html, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/graduate-outcome-validation.html"
OUT = ROOT / "docs/graduate-outcome-validation-readable.html"
SKIP_TAGS = {"table", "nav", "style", "script", "head"}
SKIP_CLASSES = {"stats-bar", "stats-caption", "doc-map"}
KEEP = {"h1", "h2", "h3", "p", "li"}
# Styled divs that read as headings in the page (section labels, card titles).
CLASS_AS = {"section-label": "h2", "card-header": "h3"}
VOID = {"br", "img", "meta", "link", "hr", "input"}

class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, skipping) for open elements
        self.skip = 0
        self.cur = None          # (tag, [text])
        self.blocks = []
        self.in_ul = False
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
            if as_tag:
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
            if text: self.blocks.append((self.cur[0], text))
            self.cur = None
        if tag == "ul": self.blocks.append(("ul-close", ""))
    def handle_data(self, data):
        if not self.skip and self.cur is not None:
            self.cur[1].append(data)

r = Reader(); r.feed(SRC.read_text())
body = []
for tag, text in r.blocks:
    if tag == "ul-open": body.append("<ul>")
    elif tag == "ul-close": body.append("</ul>")
    elif tag == "li": body.append(f"  <li>{html.escape(text)}</li>")
    else: body.append(f"<{tag}>{html.escape(text)}</{tag}>")
# drop empty lists
out = "\n".join(body)
out = re.sub(r"<ul>\s*</ul>\n?", "", out)

head = OUT.read_text().split("<body>")[0] if OUT.exists() else "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head>"
note = ('<p class="reader-note">Plain-text reading version &mdash; data tables, the stats bar, and the document-map navigation are omitted '
        'so screen-reader / listen-aloud runs straight through without stopping. Generated from '
        '<a href="./graduate-outcome-validation.html">the full study page</a> by <code>scripts/docs/make-readable.py</code>.</p>')
OUT.write_text(f"{head}<body>\n{note}\n{out}\n</body>\n</html>\n")
print(f"wrote {OUT.relative_to(ROOT)}: {len(r.blocks)} blocks")
