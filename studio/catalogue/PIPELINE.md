# Studio template → editable manifest pipeline + colour-wheel tokenization plan

Source of truth for converting **all** Canva templates in the `studio-templates` Supabase bucket into
**editable** Studio manifests (editable text mandatory; agency free recolouring via a colour wheel).

## APPROVAL STATUS (2026-07-02, Christian visual review)
Templates **#4, #1, #11, #7 are APPROVED FOR THIS STAGE** (template-engine proof) — real property facts + agency brand + colour-wheel + editable text + adaptive layout all verified on real listings across property types.
- **#4** approved for this stage · **#1** approved for this stage · **#11** approved for this stage · **#7** approved for this stage (after the title vertical-balance fix).
- **NOT production-final / not client-ready final marketing output yet:** the source property photos are **scraped/watermarked** (a **data-source limitation**, not a template/engine defect). Do NOT call this production-final for real clients — client-ready output needs clean/agency-supplied photos.
- Other open items are non-blocking for stage approval: title fonts are `needs_seed` category-correct placeholders pending the real Canva source fonts.
- No deploy (Studio is local tooling; not the deployed API/dashboard). Do not start new Studio templates unless the control tower assigns it.

## BATCH 2 — #5 / #14 / #3 / #6 (2026-07-02) — built to standard, awaiting Christian review
Control-tower review of the first batch-2 pass: #5 + #14 accepted-direction (small polish owed), #10/#15 parked (structural blockers), swap #10/#15 → a luxury + an open-house-gallery. **Catalogue post-type labels are unreliable (inferred):** #2 turned out to be an **Open House** template, and **#3 is the actual "LUXURY Villa"** — so #3 was used for the luxury slot (serves the intent; #2 would have been a 3rd open-house variant). Final batch: **#5, #14, #3, #6**, all via the SAME general engine (`renderEditable` + `deriveSlots` + `visualQA`), rendered on 3 real property types.
- **✅ #5 Listing (DARK)** — polished: bigger price/stat/website type for phone-size readability, website pill strengthened (size 40 bold). 2-line serif title, `PRICE: €…`, 3-stat row (house/bed/bath icons KEPT — universally correct). 9 editable `<text>`.
- **✅ #14 Just Sold (LIGHT)** — polished contact + agency-name block (bigger/bolder); replaces the baked "Snag Space" placeholder logo. **+ PRODUCTION ELIGIBILITY GUARD** (see below). 9 editable `<text>`.
### REPLICATION STANDARD (2026-07-03): match the Canva source, do NOT redesign
Christian review: the #3/#6 "premium refinement" was a **redesign** — rejected. New standard: **replicate the Canva source as closely as possible** (composition, positions, hierarchy, alignment, font style, image crops, stat-box placement, spacing, colours/overlays) — keep dynamic text editable + real facts. Method: keep the baked composition, **knock out ONLY the dynamic text and redraw it editable in place**.
- **⚠️ CATALOGUE NUMBERING ≠ CANVA PAGE NUMBERS (verified finding):** the bucket file numbers do NOT match Canva page numbers. **Canva page 3 = bucket 3** (LUXURY Villa ✓ source correct). **Canva page 6 = bucket 6b** (Villa in Torrevieja) — the earlier "#6 Open House Gallery" (bucket 6) was the **WRONG source**; corrected to bucket **6b**.
- **✅ #3 Luxury (Canva p3, bucket 3)** — FAITHFULLY REPLICATED: full-dark baked photo bg (no added overlay — the source bakes it); `LUXURY` serif + the type word in **SCRIPT (Great Vibes, seeded OFL font)** overlapping to the right (matches the source's "LUXURY Villa"); centered uppercase subtitle; baked rounded stat box + editable stats + website. Type word uses the REAL type (Chalet/Apartment/…).
- **✅ #6 Property Gallery (Canva p6, bucket 6b = "Villa in Torrevieja")** — FAITHFULLY REPLICATED: 4-photo grid (hero + 3 thumbnails) + agency handle + serif `{Type} in {City}` title + 4-line subtitle + baked stat row with editable labels. Baked subtitle + stat labels knocked out (no leak).
- **Engine additions (reusable):** **seeded script font** (Great Vibes) for script accents; gradient `scrim` + per-slot `tracking` + `eligibility` guard (from earlier).
- **All green:** cross-type QA 12/12, recolour proofs #3/#6 PASS, phase-2 PASS, engine.test PASS, approved-set (#4/#1/#11/#7) regression PASS, tsc 0. **#5/#14 untouched. None approved — awaiting Christian re-review vs Canva.** Blockers noted: some baked source elements (photo-grid positions, stat-box geometry) are fixed; the exact Canva title faces stay `needs_seed` (style now matched via serif + Great Vibes script).
- **All green:** QA PASS on all 4 × 3 property types (12/12), recolour proofs 5/5-style PASS (#5/#14/#3/#6), phase-2 `validate:04` PASS, engine.test PASS, approved-set (#4/#1/#11/#7) regression PASS, `tsc` 0.
- **PRODUCTION ELIGIBILITY GUARD (`engine/eligibility.ts` + manifest `eligibility`):** a status-gated post (e.g. #14 "Just Sold") renders ONLY when the property's status matches, or on an explicit demo/test render. Demonstrated: #14 on an active listing (no demo) → **BLOCKED**; explicit demo → allowed as **template-engine proof only, not a real sold claim**. The demo properties are `status: active`, so all #14 renders in the sheet are labelled DEMO.
- **⚠️ #10 New Listing + #15 Luxury Living — PARKED (caveats documented, do NOT ship half-good):** #10's dominant `NEW`/`LISTING` type + price pill are **baked teal outlined paths** (need a proper font/re-render solution before they meet the colour-wheel standard); #15 has too many unavailable spec fields (Lot Area/Garage/Dining/Bonus) + a **script subtitle** font the vault lacks.
- Review sheet: `out/realprop/review/batch2_new_templates.png` (4 templates × 3 types; #14 marked DEMO). **Watermarked source photos remain a data-source limitation; nothing client-ready. None approved — awaiting Christian review.**
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

Outputs (gitignored `out/realprop/IC-28746/`): `final_{4,11,1,7}.png`, `contact_sheet.png`, `#7` side-by-side + recolour, `final_report.json` (per-slot editability + QA). **Not marked SOLID — awaiting Christian visual review.**

### Round 2 — GENERAL fixes (must work for ALL properties, not one) + cross-type proof (2026-07-02)
Christian rule: **no per-property patches — every fix works for all properties + is consistent across types/info** ([[feedback-general-not-perproperty]]). `finalRender.ts` now renders **multiple real property types** (chalet 5-feat · apartment 2-feat · bungalow 0-feat + missing size) through the SAME engine → `out/realprop/consistency_sheet.png` (3 templates × 3 types) proves consistency.
- **General slot derivation (`deriveSlots(facts, agency)`):** ALL slot text is a pure function of the property facts + agency — `{Type} in {City}` titles, beds/baths/size stats, feature list = beds + baths + top real features, agency contact. **No hardcoded per-property strings.** Handles the full range: missing size/price omitted (never invented), 0 features → feature list shows just beds+baths.
- **Empty-slot handling (`renderEditable`):** an empty text slot knocks out its baked source copy but draws nothing → a property with fewer features than the template has rows hides the extra rows cleanly (no baked leak).
- **#7 baked feature icons NEUTRALIZED:** the fixed bed/bath/kitchen/sofa/garage icons can't track arbitrary real features across properties, so (per the rule) they're knocked out and the feature text is a clean left-aligned list in the freed space — rather than cherry-picking text to fit the icons.
- **#1 CTA re-layout:** badge + contact are contiguous, **non-overlapping auto-fitting zones** over a full-strip knockout → the "SCHEDULE A CALL / phone" collision + baked "LL" leak are gone for **any** agency phone/website length.
- **Stray baked artifacts (all template-level, fixed once for every property):** #11 title-panel `)` + eyebrow mark, #7 CTA-bar `)` (extend the owning slot's knockout to the bar edge — fills dark-on-dark, no bleed).
- **New Visual QA:** **(8) no CTA/adjacent-slot collision** — no two text slots overlap in both axes (combined with the width rule ⇒ no CTA overprint at any contact length); **knockout-cleanliness now excludes text pixels** so a full-bar knockout is verified only on its text-free parts (where a leaked/stray glyph would still show). The icon-mismatch case is covered by the icon-column being a verified-clean knockout region.

**All green:** cross-type visual QA PASS (chalet/apartment/bungalow × #11/#1/#7), editable proofs 5/5, phase-2 `validate:04` PASS, `engine.test` PASS, `tsc` 0. Residual (not layout): portal-watermarked scraped photos (data-source); title fonts still needs_seed placeholders. **#4 = near-approved (clean-photo caveat); #11/#1/#7 fixed — awaiting Christian visual review; none marked SOLID.**

### Round 3 — #11 brand + #7 adaptive panel (2026-07-02)
Control tower accepted the systemic direction + #4/#1 as near-approved; two remaining defects fixed generally:
- **#11 brand block** — the agency name rendered tiny (a 2-line name auto-fitting into a 1-line box). Fixed: a proper 2-line brand box at a readable fixed size (auto-fit only shrinks longer names), its knockout covers the whole baked "YOUR AGENCY" strip, and `splitTwoLines` now splits at the **balanced** word break ("Mediterráneo / Costa Homes", not "Mediterráneo Costa / Homes").
- **#7 adaptive feature panel** — new `renderEditable` capability `adaptive_panel {area, fit_to, pad, fill_role}`: everything in the baked panel below the last non-empty `fit_to` row (+pad) is filled with the page-bg colour, so the beige panel **shrinks to its row count**. Proven across 5-feat (full) / 2-feat (medium) / 0-feat (short, 2 rows) — no more tall empty panel. Visual QA excludes the trimmed band from the knockout-cleanliness check.
- **All green:** cross-type QA 9/9, editable proofs 5/5, phase-2 PASS, engine.test PASS, tsc 0. **#11 + #7 re-fixed; #4 + #1 unchanged (still near-approved) — awaiting Christian visual review; none SOLID.**

### Round 4 — #4/#1/#11 approved-for-stage; #7 title vertical balance (2026-07-02)
Christian visually approved #4, #1, #11 for this stage. **#7 only**: layout-only refinement of the title's vertical balance (title block felt high/awkward — the title→body gap was 114px vs ~45px outer margins).
- **#7 title/body repositioned** (manifest-only): title bbox `[69,590,600,840]`→`[69,646,600,846]` (down + shorter), body bbox `[70,898,590,974]`→`[70,876,590,956]` + `valign:center`. Title+details now read as one unit centred in the left column between the hero and the thumbnail strip. Measured gaps hero→title / title→body / body→thumb ≈ **73/65/75** (was 42/114/56). General — valign centres whatever the derived title/body are; consistent across chalet/apartment/bungalow.
- **Baked-text knockout follows the SOURCE, not the new box:** moving the box exposed the fixed-position outlined baked title/body, so `knockout_regions` gained the baked title `[60,590,606,842]` + baked body `[64,896,592,974]` (erase-at-source; draw repositioned text on top). No engine change, no icons, adaptive-panel logic untouched.
- **All green:** cross-type QA 9/9, editable proofs 5/5, phase-2 PASS, engine.test PASS, tsc 0. Only `manifest/templates/7.editable.json` changed. **RESULT: #7 APPROVED FOR THIS STAGE (Christian, 2026-07-02) after the title-balance fix — all four (#4/#1/#11/#7) approved for this stage. See the APPROVAL STATUS block at the top (not production-final; watermarked source photos).**
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
