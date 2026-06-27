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

## Tooling status
- `engine/bucketInventory.ts` — discovery/inventory (this catalogue). Re-runs as templates are added/updated. Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (repo `.env`).
- `vault/`, `adjudicate/`, `engine/extractManifest.ts`, `engine/engineProof.ts`, `engine/colourMap.ts`, `engine/q3LocalWiring.ts` — the proven #4 toolchain that each template runs through.
- **Next** per template: prepare `intake/<n>/` (geometry measure) — currently only #4 done. Bulk intake of the other 12 is the follow-on build (each is a measure pass; no decisions blocking the structural work, though post-type taxonomy + canonical palettes are Chat 1 main / `Q5`).
