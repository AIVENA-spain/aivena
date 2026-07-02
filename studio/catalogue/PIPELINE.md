# Studio template → editable manifest pipeline + colour-wheel tokenization plan

Source of truth for converting **all** Canva templates in the `studio-templates` Supabase bucket into
**editable** Studio manifests (editable text mandatory; agency free recolouring via a colour wheel).

## Discovery truth (2026-06-27, `engine/bucketInventory.ts`)
- **13 templates** present: 1, 2, 3, 4, 5, 6, 6b, 7, 8, 10, 11, 14, 15. All **1080×1350 (4:5 portrait) = Instagram/current**. **0 Facebook/later** (FB is the separate, later size family — not in this bucket yet). Missing numbers (9, 12, 13, 16–22) are not uploaded; "ALL 20+" is the eventual target, not the current bucket.
- Each template has a raw `<n>.svg` (Canva export, up to ~22 MB) + a `<n>.tokenized.svg` (photo-tokenized, ~75–300 KB) + `backups/` and `fix_*` variants.
- **Photo slots ARE tokenized** (`@@PHOTOn@@`, 1–4 per template) — the deployed `POST /studio/render` already fills them.
- **Text is OUTLINED to `<path>` (0 `<text>` elements in every template)** → NOT editable, and no font-family in the SVG. Making text editable (mandatory) is the Studio engine's job: identify the font from the glyphs (vault adjudicator) and re-render real editable text from the manifest.
- **Colours are BAKED fills (0 colour tokens)** → not yet recolourable. Distinct fills per template range 2–6. The colour-wheel goal needs a role→token tokenization pass.

## Per-template pipeline (generalizes the proven #4)
**A. Intake** — pull `<n>.tokenized.svg` (+ raw for hi-fi measure) → `studio/intake/<n>/`. Render at supersample; cluster outlined paths into text regions; measure each block's bbox / baseline / cap-height (reuse `resolver` measurement). Detect photo slots (`@@PHOTOn@@` `<image>` boxes), fixed art (icons/dividers), overlays. Author `intake/<n>/template.json` (layer ids/types/bboxes/`match_mode`/categories/metadata; `production_override` where the source font is unresolved).

**B. Adjudicate + extract** — `studio_adjudicate <n> --mode production` → per-layer font (faithful identification, or a recorded production improvement like #4 title → Libre Caslon Display). `extractManifest <n>` → vault-backed font bindings + `extracted_manifest.json`.

**C. Editable manifest** — author `manifest/templates/<n>.editable.json`: `editable_text` / `editable_text_block` slots (real re-rendered text, **replacing** the outlined source — never flattened), `photo_slot` (`@@PHOTOn@@`), `fixed_art`, `overlay`, `colour_tokens`, per-slot font from the adjudicator. **This is the step that makes outlined text editable.**

**D. Colour tokenization (colour wheel)** — extract baked colours; assign each to a **role token**; replace baked fills with token references (per-layer `color_token`). See plan below.

**E. Render proof** — `composeOne --manifest <n>` (Q3 local wiring) renders real property facts through the editable manifest = **Engine Proof A** (local). **Engine Proof B** = the deployed Railway `/studio/render` extended from photo-only fill to text + colour-token fill (gated: deploy + Chat 3 CC).

## Colour-wheel / role-token plan (reframes Q4)
Not "waiting for a navy/gold brand decision" — the work is **role→token mapping + per-role recolour controls** so any agency recolours freely.
- **Role tokens** (per template element; #4 already defines this set): `background`, `overlay`, `title`/`accent`, `body`, `stat`, `badge.fill`, `badge.text`, `divider`, `icon`. `locked` roles (background/overlay/icon) stay fixed unless explicitly unlocked.
- **Per-agency palette** = `{ role → { hex, opacity } }` (existing palette format); the engine resolves token → hex at render (`resolveToken`, already built). The **colour-wheel UI** binds one wheel control per role; agencies set any hex.
- **Cross-role collision handling (Q4 finding, reframed):** where several roles share a default hex (e.g. #4 source: 5 roles → `#ffffff`), the tokenizer/UI must expose them as **separate controls** so recolouring one role (e.g. title accent → gold) doesn't silently change others. `engine/colourMap.ts` flags these collisions per template so the token design separates them. This is **tokenization work**, not a brand-colour blocker.
- **navy/gold** (#0B2545/#C9A45C) are just two possible agency picks — the wheel must not hardcode them; they become palette values once an agency (or a default theme) chooses them.

## Bulk auto-intake (DONE — first-pass drafts for all 13)
`engine/autoIntake.ts` produces a **draft intake skeleton** per template (`studio/intake/<n>/template.draft.json` +
`studio/catalogue/intake_draft_summary.json`) by analysing the tokenized SVG:
- **canvas** + aspect; **photo slots** per distinct `@@PHOTOn@@` token (render-that-token-magenta vs stripped, full diff bbox — robust to overlays, post-transform/clip). Multi-photo grids resolve correctly (#7 → hero + 3 thumbnails).
- **text-region candidates** via polarity-aware ink projection (modal-bg detection → bands → blocks), with heuristic `title`/`subtitle-body`/`stat`/`badge`/`label` labels.
- **colour fills** + first-pass **colour-role candidates** (darkest→background, lightest→title/body ink, mid→accent), against the flexible role set.
- Validated against #4: a detected region overlaps each known #4 content zone (stat_row / title / body) — **3/3 covered**.

**Known first-pass limits (drafts, not final):** heavy dark overlays can mask part of a photo box (e.g. #4 photo detected as the right ~2/3, true box is full-canvas); vertically-packed text merges into one region (#4 title's 2 lines + body); heuristic labels are hints. A human/next-step refines each draft into a final `intake/<n>/template.json` + editable manifest (the proven #4 path). **Outlined source text is never final — the editable manifest re-renders real editable text.**

## Colour tokenization + generic editable renderer — proven on #11 (light) + #1 (dark) + #7 (multi-photo) (2026-06-27)
- `engine/colourTokenize.ts` — role-agnostic. Renders the template (polarity-aware) and **samples the actual colour per content region** (high-contrast-from-background, so a thin dark headline beats a large light panel), mapping to the flexible role set. **Each role is a SEPARATE token even when two roles share the same hex** → the colour wheel recolours them independently. Output: `intake/<n>/colour_tokens.draft.json`. Verified on #11 (light: bg `#fff`, ink `#000`) and #4 (dark: bg `#000`, ink `#fff`).
- `engine/renderEditable.ts` — **generic** editable renderer (multi-template; simpler than the #4-bespoke `composeOne`). Renders the tokenized SVG as a background raster (photo filled), then **knocks out each text region (local-bg sampled) and draws REAL editable `<text data-editable>`** in its role-token colour. Palette `{role → hex}` resolves colours at render. Manifest schema: `{canvas, source_svg, photo_token, colour_tokens, text_slots:[{id, role, source, bbox, font, align, text}]}`.
- `engine/proofEditable.ts` — **generic** editable+recolour proof for ANY manifest: renders default vs a palette giving each distinct role a distinct test colour, and asserts editable `<text>`, photo fill, per-role recolour, and same-default-hex independence.
- The renderer supports an optional **legibility `overlay`** (a scrim role over the photo, baked into the backdrop before knockout) so dark templates stay readable over bright photos.
- **#11 proof** (light template; `proofTemplate11.ts`, `11.editable.json`, `assets/11/`): 7/7 — 5 `<text data-editable>`; photo fills; title + address (both `#000000`) recolour to navy + gold independently.
- **#1 proof** (Open House — DARK template; `proofEditable.ts`, `1.editable.json`, `assets/1/`): 5/5 — 7 `<text data-editable>` (stat row ×3 + title 2 lines + badge + cta); photo fills + 0.45 legibility overlay; **all 6 white-default roles recolour to 5 distinct colours independently** (title/stat/badge/cta). Proves the path across the opposite polarity from #11. Proof art (gitignored): `out/engine/<id>/proof/recolour_A_vs_B.png`.
- **#7 proof** (Discover Your Dream — MULTI-PHOTO; `7.editable.json`, `assets/7/`): 5/5 — **16 `<text data-editable>`**; **all 4 photo slots fill with REAL photos (hero + 3 thumbnails)**; roles recolour independently. `renderEditable` supports `photo_slots: [{token}]` (hero + thumbnails) alongside single `photo_token` (back-compatible; #1/#11 unchanged).
  - **Technical multi-photo support: PASSED.** The first #7 *visual/editor* proof was **REJECTED** (control tower, 2026-06-27) as not close enough to the Canva original + the feature list was left baked. **Rebuilt (2026-07-01):**
    - **Feature list is now fully editable** — the 5 rows (`4 Bedrooms`/`3 Bathrooms`/`Modern Kitchen`/`Living Room`/`Car Garage`) + `Home Features:` header are real editable `<text>` slots. Only the feature ICONS (x655-707) + CTA phone/location icons stay baked art; text beside them is editable and its bbox starts after the icon.
    - **Geometry re-measured from the rendered baked source** (`out/bucket/7.dbg_bg.png`), not the auto-intake draft — every bbox/size derived from actual ink positions. This fixed a **doubling artifact** (overlay text mis-placed above the baked title): its root cause was a **resvg quirk** — text in the SAME svg as a large embedded data-URI `<image>` mis-scales; `renderEditable` now renders the overlay ALONE (transparent) and composites it onto the bg raster with `sharp`.
    - **Per-slot `size` / `line_height` / `weight` (faux-bold)** added to the slot schema for display-type fidelity; the vault has no bold geometric-sans face (needs_seed), so bold is approximated with a same-colour stroke (Poppins-Regular base). Title weight/size now closely matches the original.
    - Proof art (gitignored): `out/engine/7/proof/side_by_side_original_vs_editable.png` (full-size ORIGINAL vs EDITABLE), `recolour_A_vs_B.png`, `editable_A_default.png`. **Awaiting Christian's browser/visual sign-off — not auto-marked SOLID.** Remaining fidelity gap = the true bold title face (needs_seed; Canva source-font confirmation owed).

## Real-property final render + Visual QA (2026-07-02)
`engine/finalRender.ts` runs ONE real property (IC-28746, agency Mediterráneo Costa Homes; real facts + brand + photos) through the closest real/full engine path per promoted template (#4 → `composeOne`; #11/#1/#7 → `renderEditable`) and emits agency-ready renders + a contact sheet. A first pass surfaced real visual defects; the fixes below are now in the engine + gated by `engine/visualQA.ts`.

**Renderer upgrades (`renderEditable.ts`):**
- **Auto-fit (width + height):** each slot's text is measured with `fontkit` (`textWidth`) and the font-size + line pitch shrink so the widest line fits `bbox width − 2·pad` AND the block fits the bbox height. Real property values (longer than the Canva placeholders) no longer overrun or touch dividers/edges. `composeOne` already had fit; the generic renderer now does too.
- **`pad` / `valign`** per slot: inner padding kept clear of edges (divider clearance) + vertical placement (`top`/`center`/`bottom`) so short real titles balance in a box sized for longer placeholder copy (fixed #7 "title too high").
- **`knockout_regions`** (manifest-level): erase stray baked source artifacts (local-bg fill) — fixed the #11 stray glyph. The cleanest fix is usually to widen the owning text slot's bbox so its own knockout covers the whole baked strip.
- **`#4` title logic (`compose.ts`):** now a meaningful property title `"{Type} in {City}"` (e.g. "Chalet in San Javier") instead of a vague one-word type ("chalet"). Both parts are property facts → still traces to facts (no-hand-assembly + fact_safe stay clean; engine.test green).

**Visual QA gates (`engine/visualQA.ts`, run on every real render + a standalone regression):**
1. **no text touching divider lines / edges** — measured width ≤ `bbox − 2·pad`.
2. **title/body stay in safe zones** — the rendered text block is vertically inside its bbox.
3. **title copy meaningful with real data** — a title slot must be ≥2 words or ≥10 chars (rejects "chalet").
4. **no stray baked artifacts** — each declared `knockout_region` renders as a near-uniform patch (low luma stddev).
5. **contact/info bars not cramped** — same width+padding rule applies to cta/contact slots.
6. **legibility floor** — auto-fit never shrinks below 12px.
7. **final agency-ready real-property render, not only technical proof** — enforced by `finalRender.ts` running this QA on the real renders (fails the run on any check).

Outputs (gitignored `out/realprop/IC-28746/`): `final_{4,11,1,7}.png`, `contact_sheet.png`, `#7` side-by-side + recolour, `final_report.json` (per-slot editability + QA). **Not marked SOLID — awaiting Christian visual review.** Remaining cross-template gaps: portal-watermarked scraped photos (data-source, not layout); title fonts still needs_seed placeholders; #7 baked feature icons don't semantically match arbitrary features.
- First-proof grade for both — fonts default (Poppins / Libre Caslon Display) pending per-template adjudication; geometry from the auto-intake draft; no invented property facts (stats = real bedroom/bathroom; title/labels/contact = template/agency copy). Remaining per-template manual needs: precise geometry measurement, font adjudication, overlay/contrast tuning, and badge-pill styling (badge currently re-rendered as plain text).

## Font adjudication — titles (2026-06-27)
`engine/adjudicateFont.ts` runs the frozen v1 adjudicator (SHAPE mode — render the known title line in each
active vault font + align glyph outlines; content-independent features alone cannot tell a serif title from a
sans one). Result (`catalogue/font_adjudication.json`): **all three promoted titles = `needs_seed`** — no
vault font is a clearly-close match (all < USABLE 0.72):
- **#4 "Luxury"** → needs_seed (best Libre Caslon Text 0.579) — reproduces the Q9 finding; #4 title stays the **Libre Caslon Display** production improvement (faithful = needs_seed).
- **#11 "STEP INTO YOUR"** → needs_seed (best 0.447) — a bold geometric sans the vault lacks; **Poppins** kept as a category-correct (sans) placeholder.
- **#1 "OPEN"** → needs_seed (best Poppins 0.613 ≈ Libre Caslon Text 0.600, ambiguous) — a high-contrast display serif the vault lacks; **Libre Caslon Display** kept as a category-correct placeholder.
**No fonts were blindly changed.** The honest read: the vault (Prata/Poppins/Libre Caslon Text/Display + Tinos seed_only) does **not** contain the Canva title faces. To reach a *faithful* title, the actual source fonts must be identified + seeded — **needs Christian / Canva source confirmation** per template. Until then the manifests use category-correct production placeholders (recorded in each manifest's `title_font_status`).

## Tooling status
- `engine/bucketInventory.ts` — discovery/inventory (catalogue). Re-runs as templates are added/updated. Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (repo `.env`).
- `engine/autoIntake.ts` — bulk first-pass intake drafts (above).
- `vault/`, `adjudicate/`, `engine/extractManifest.ts`, `engine/engineProof.ts`, `engine/colourMap.ts`, `engine/q3LocalWiring.ts` — the proven #4 toolchain that each refined template runs through.
- **Next** per template: refine each draft → measured `intake/<n>/template.json` → adjudicate → editable manifest (editable text + colour tokens) → render proof. Only #4 is fully done; the 12 drafts are the head-start. **Asset gap:** templates 9/12/13/16–22 + all Facebook-size templates are absent from every bucket (owner: Christian/Chat 1 main — export from Canva + upload). Post-type taxonomy + canonical palettes/roles = Chat 1 main / `Q5`/`Q4` (do not block the structural refinement).
