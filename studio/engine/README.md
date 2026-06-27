# Studio Engine — `Q2` Manifest extractor + `engine_proof`

Builds on the Engine Spine (Font Vault + vault-backed adjudicator). Two tools that move Studio toward
production-renderer proof by binding the adjudicator's font truth into the renderer manifest and proving the
real **studio-compose** engine fills **real property** data with no hand-assembly.

## What this is (and is NOT)

- **IS:** a LOCAL engine proof (call it *Engine Proof A*) — the existing `composeOne` engine fills real
  `facts/*.json` into the #4 template and renders, with machine-checkable provenance + no-hand-assembly
  invariants, and with fonts bound to the adjudicator + vault.
- **IS NOT:** the production renderer (Railway `/studio/render`) — that is `Q3` / *Engine Proof B*. Not run here.
- **IS NOT:** a production-frozen claim for #4. The #4 **title** font is still `needs_seed` (`Q9`); the manifest
  hard-sets Prata, which the adjudicator does **not** confirm. The proof surfaces this honestly.

## Tools

```
npx tsx engine/extractManifest.ts 04     # bind manifest fonts -> adjudicator + vault; flag unconfirmed
npx tsx engine/engineProof.ts 04         # run studio-compose on REAL properties; emit engine_proof dossier
npx tsx engine/engine.test.ts            # self-verifying acceptance harness (exit 1 on failure)
```

### `extractManifest.ts` — manifest extractor
Reconciles the Phase-2 editable manifest's per-slot fonts with the adjudicator's vault-backed decisions
(`out/adjudicate/<id>/report.json` + `vault/fontVault.json`). Emits, to `out/engine/<id>/`:
- `manifest_bindings.json` / `.md` — per-slot: manifest font ↔ adjudicator label/score ↔ vault entry, with
  `confirmed` and `agrees_with_manifest` flags and `unresolved_slots`.
- `extracted_manifest.json` — the editable manifest annotated with the resolved bindings (renderable;
  `composeOne` ignores unknown fields). Unconfirmed slots carry `font_status` (e.g. `needs_seed`).

For #4: **stats → Poppins** and **body → Libre Caslon Text** are adjudicator-confirmed
(`verified_visual_match`); **title** is `needs_seed` (manifest's Prata is **not** confirmed → `Q9`).

### `engineProof.ts` — engine_proof
Runs the real `composeOne` engine on real properties and asserts invariants per render:
- `render_produced`, `fonts_vault_backed`, `deterministic` (re-render → identical SVG bytes),
- `no_hand_assembly` — every editable value traces to a real fact or fact-derived copy; no placeholder, no
  invented number, no invented required fact,
- `factuality_honest` — subjective claims are flagged (`source_faithful`) or removed (`fact_safe`), never
  silently asserted as fact.

Properties proven (`out/engine/<id>/engine_proof/`):
- **IC-26537** (`source_faithful` + `fact_safe`) — renders real facts (55 m² / 1 bed / 1 bath + generated
  body copy); `fact_safe` drops the unsupported "luxury".
- **IC-26537-nobeds** (negative) — a real-but-incomplete property; the engine **refuses to invent** the
  missing required `bedrooms` (fails closed). This is proof of no-hand-assembly.

## Reuse (no rewrites)
Reuses `src/lib/compose.ts` (`composeOne`), `src/lib/fonts.ts`, the vault (`vault/buildVault.ts`), and the
adjudicator report. No engine logic was duplicated; no matcher/threshold tuning.

## Unblocks `Q3`
The bindings + `extracted_manifest.json` are the input for wiring approved manifests into `studio-compose`
on the production renderer (Engine Proof B). The title remains gated on `Q9` (font/source truth).
