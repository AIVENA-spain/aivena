# Studio Typography Resolver — v0 (local, dry-run)

Identifies the editable font (family/weight/style) of an outlined Canva-style template text layer by matching against a **controlled local font library**, returns a per-layer confidence + `accept`/`review`/`fail` decision, and emits a human-reviewable proof package. **Never silently guesses**: only HIGH-confidence, well-separated matches are accepted; medium/low go to review/fail with evidence and "needs seed".

## Scope (v0)
- **Local only. No network of any kind** (no Canva API, no font downloads), no DB, no providers, no KIE, no dashboard, no production renderer, no deploy.
- **The Canva-API metadata path (read the font name from the editable Canva design) is DEFERRED** to a later build that is allowed network/API access. v0 implements the automated-matching path only.
- Reuses the existing `studio/src/lib` natural-1:1 renderer + ink/threshold primitives read-only.

## Run
```bash
cd studio
# #4 ground-truth gate (renders the source from assets/04/source_nophoto.svg if needed):
npx tsx resolver/studio_resolve.ts --job resolver-jobs/04.resolve.json [--inkThreshold 185]
# fail-closed fixtures:
npx tsx resolver/studio_resolve.ts --fixtures
```
Outputs land in `studio/out/resolver/` (git-ignored): `<template>.report.json`, `<template>.summary.txt`, and per-layer `*.overlay.png` / `*.contact.png`.

## Matching modes (per layer)
- **shape** — render the KNOWN layer text in each candidate at matched cap-height, align (size-normalised IoU + small shift), score shape + stem + spacing + pixel + metric_fit. Used for the #4 **title** (text "Apartment" is known).
- **metric** — content-independent: stem width + cap/x-height ratio + stroke contrast + category, measured from the source region (no source text needed). Used for the #4 **stats** and **body** because their exact source strings are not available to CC. Labelled per layer in the report.

## Font-library rule (the key footgun)
resvg matches by the font's **internal family name**, not the filename; multi-word names silently fall back to a default (no ink). So `declared_family` in `fontLibrary.json` is the **internal** name (verified at load against the TTF name table). Mismatch → the entry is **excluded + warned** (see `fix_badname`). A render that produces no ink → excluded (fallback guard). The library can only identify fonts it contains; a true font that is absent → LOW/`fail` + "needs seed" (see `fix_missing`).

## Confidence / decisions
- HIGH (`accept`): confidence ≥ 0.85 AND separation ≥ 0.06 AND rendered_ok → emits a manifest_mapping.
- Ambiguous (high score, separation < 0.06) → `review` (never accept) — see `fix_near`.
- MEDIUM (≥ 0.70) → `review`. LOW → `fail` + "needs seed". Thresholds/weights are calibrated on #4 and recorded in the report.

## Manifest writes
Default is **dry-run** (writes only to `out/resolver/`). `--write` (gated behind `--confirm`) would merge ONLY `accept` mappings into a template manifest — **not used in v0**.

## #2 status
**BLOCKED** — no #2 source asset in the repo. Drop `assets/02/source_nophoto.png` (1080×1350, white outlined text on black) or a Canva #2 SVG, then set the `resolver-jobs/02.resolve.json` bboxes. No fonts are assumed for #2 (Italiana / Monsieur La Doulaise are untrusted notes and are intentionally not baked in); the resolver will flag missing/low-confidence honestly.
