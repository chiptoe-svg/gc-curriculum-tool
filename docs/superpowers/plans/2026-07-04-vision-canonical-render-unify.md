# Vision Canonical-Render Unify — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Render every vision input (OCR pages, slides, Docling figure crops) to *canonical, aspect-exact, 48-aligned* pixels sized to a per-task soft-token budget, and send `max_soft_tokens = B` (DGX) / `vision_soft_tokens_per_image = B` (local omlx) — so resolution is identical regardless of which backend serves it. Implements the render contract in `/tmp/dgx-testdocs/vision-render-checksum-contract.md`.

**Architecture:** A pure `canonicalDims(B, srcW, srcH)` helper (closed-form geometry) + a `canonicalize(rawPng, B)` image op (sharp: resize to W×H_content, bottom-pad white to 48-grid). The three vision paths compute a per-task B, canonicalize each image, and send B to whichever backend. The DGX validates `tokens ≤ B` + `dims%48`; local omlx honors the same B via its knob (no-op resize on canonical pixels).

**Tech Stack:** TS strict, Vitest, `sharp` (new dep) for resize+pad, existing `pdftoppm` for rasterization.

**Budgets:** OCR (`transcribeDocument`) = 1120; slides (`describeSlides`) = 560; captions (Docling) = adaptive (render crop native ≤1120-canonical, B = smallest tier ≥ rendered tokens). Tiers: {70,140,280,560,1120}.

---

### Task 1: `canonicalDims` pure geometry helper

**Files:** Create `lib/ai/vision-canonical.ts`; Test `lib/ai/__tests__/vision-canonical.test.ts`

- [ ] Write failing test: `canonicalDims(1120, 850, 1100)` → `{width:1392, height:1824, tokens:1102}` and `tokens ≤ B`, dims % 48 == 0; also 4:3 (1120→1824×1392/1102), 16:9 (1120→2112×1200/1100), 560 cases, and the guard (tokens never > B).
- [ ] Implement: constants PATCH=16, POOL=3, UNIT=48, PX_PER_TOKEN=2304, SOFT_TOKEN_TIERS=[70,140,280,560,1120]; `tokensForDims(w,h)=(⌊w/16⌋*⌊h/16⌋)/9` (exact for 48-multiples); `canonicalDims(B,srcW,srcH)` per the reference function (48-floor W, H_content=W/a, ceil-48 pad, while tokens>B → W-=48); `pickCaptionBudget(nativeTokens)=smallest tier ≥ nativeTokens (cap 1120)`.
- [ ] Run tests → pass. Commit.

### Task 2: `canonicalize` image op (sharp)

**Files:** add `sharp` to package.json; Create `lib/ai/vision-canonicalize.ts`; Test `lib/ai/__tests__/vision-canonicalize.test.ts`

- [ ] `pnpm add sharp`; verify `require('sharp')` loads on this arm64 Mac.
- [ ] Write failing test: `canonicalize(pngBuffer, 1120)` on a synthetic 1000×1300 white PNG → output dims are `canonicalDims(1120,1000,1300).{width,height}`, both %48==0, and `tokensForDims(outW,outH) ≤ 1120`.
- [ ] Implement `canonicalize(raw: Buffer, B: number): Promise<{png: Buffer, tokens: number, budget: number}>`: read `sharp(raw).metadata()` → w,h; `d=canonicalDims(B,w,h)`; `sharp(raw).resize(d.width, d.contentHeight, {fit:'fill'}).extend({bottom:d.height-d.contentHeight, background:'#ffffff'}).png()`; return {png, tokens:d.tokens, budget:B}.
- [ ] Run tests → pass. Commit.

### Task 3: render at budget-adequate DPI

**Files:** Modify `lib/capture/render-pages.ts`

- [ ] Bump `runPdftoppm` to render at a resolution that does not upscale the largest canonical width in use (OCR 1120 → up to ~2112px on 16:9). Use `-scale-to-x <targetW>` when a target width is known, else raise `-r` to ~220. Keep the MAX_SLIDES=60 cap. (Decision: render raw high enough that `canonicalize` only ever downscales.)
- [ ] Existing render tests still green (no signature break for current callers). Commit.

### Task 4: OCR path (`transcribeDocument`)

**Files:** Modify `lib/ai/local.ts`

- [ ] After `renderToImages`, `canonicalize` each page at `B = visionModel('docTranscribe').budget` (1120).
- [ ] Offload send: replace the dropped-knob body with `max_soft_tokens: B` (+ keep temperature/max_tokens/repetition_penalty). Local send: `vision_soft_tokens_per_image: B` (unchanged mechanism, same B). Both consume the SAME canonical png.
- [ ] Update/extend `local-transcribe` tests to assert the offload body carries `max_soft_tokens` and the image is canonical (%48 dims). Run → pass. Commit.

### Task 5: Slides path (`describeSlides`)

**Files:** Modify `lib/capture/slide-vision.ts`

- [ ] `canonicalize` each slide png at `B = visionModel('slideNote').budget` (560) before both backends.
- [ ] `describeSlideOn`: send `max_soft_tokens: B` on the offload backend (was: nothing) and keep `vision_soft_tokens_per_image: B` on local. Same canonical png to both.
- [ ] Extend slide-vision tests (offload body has `max_soft_tokens`, dims %48). Run → pass. Commit.

### Task 6: Captions path (`/api/vision-proxy`, adaptive)

**Files:** Modify `app/api/vision-proxy/route.ts`

- [ ] The proxy receives Docling's crop image. Decode dims; render/keep native (downscale to 1120-canonical only if native tokens > 1120); `B = pickCaptionBudget(renderedTokens)`.
- [ ] Forward to DGX with `max_soft_tokens: B` (was: delete the knob). Local fallback: `vision_soft_tokens_per_image: B`. Same canonical crop to both.
- [ ] Add a proxy test (small crop → small tier; oversized crop → capped 1120; body carries `max_soft_tokens`). Run → pass. Commit.

### Task 7: config, docs, deploy, E2E

**Files:** `.env.example`, `docs/STATE.md`, `~/.dev-ports.yaml`, deploy build

- [ ] `.env.example`: note the per-task budgets are the canonical-render targets; `sharp` is now a dep.
- [ ] STATE.md: record the unify (canonical render, `max_soft_tokens=B` to DGX / `vision_soft_tokens_per_image=B` to local, sharp dep, resolution now routing-independent).
- [ ] Full `pnpm vitest run` green; `pnpm exec tsc --noEmit` clean.
- [ ] Build the deploy; live E2E: canonical dims land at the router (a real OCR page → DGX accepts `max_soft_tokens=1120`, tokens 1102 ≤ 1120; a small figure → adaptive tier). Commit + STATE.md in same commit.

---

## Notes
- Backend param split: **DGX = `max_soft_tokens`**, **local omlx = `vision_soft_tokens_per_image`** — same numeric B. Canonical pixels make both a no-op resize.
- The DGX ceiling-check + encode-as-is is the *other instance's* side (contract handed off); this client is forward-compatible with either that or a resize-to-B DGX.
- Legibility floor (~8px) is the one empirical constant; OCR@1120 has margin.
