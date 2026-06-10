# Studio section images — drop your AI-generated images here

The landing's **Studio** section is wired to use real images automatically.
Just drop these **4 files** into this folder (`marketing/v2/assets/`) with these
**exact names**. No code change needed — they appear on next page load.
Until a file exists, the page falls back to the built-in gradient mockup, so
nothing ever looks broken.

| Filename             | Used for            | Aspect ratio | Suggested size | Content |
|----------------------|---------------------|--------------|----------------|---------|
| `ad-villa.webp`      | Meta ad creative    | 4:5 portrait | 1200 × 1500    | Beachfront / sea-view Costa Blanca villa, golden hour. Keep the top edge and bottom third uncluttered — the agency badge sits top-left, the headline + price + CTA sit bottom. |
| `social-seaview.webp`| Social post         | 1:1 square   | 1200 × 1200    | Sea-view property / terrace at sunset. Keep the bottom-left calm for the caption + button. |
| `stage-before.webp`  | Virtual staging — BEFORE | 4:5 portrait | 1200 × 1500 | An **empty, unfurnished** room (bare walls/floor), nice window light. |
| `stage-after.webp`   | Virtual staging — AFTER  | 4:5 portrait | 1200 × 1500 | The **same room, same camera angle**, now furnished & styled. |

## Notes
- The cards crop to fill (`object-fit: cover`), so aspect ratio matters more than exact pixels.
- Keep each file under ~400 KB for fast loading. `.webp` is ideal; if you export `.jpg`/`.png`
  instead, just tell me and I'll switch the extensions in the code.
- **Before/after must line up.** Generate `stage-after` *from* `stage-before`
  (img2img / "stage this room") so the walls and window match — that's what makes
  the drag-to-compare slider convincing.

## Prompt ideas (any image tool — Midjourney, DALL·E, etc.)
- **ad-villa:** "Photorealistic modern Mediterranean villa with infinity pool overlooking the sea, Costa Blanca, golden-hour warm light, professional real-estate photography, wide angle"
- **social-seaview:** "Photorealistic sun-drenched coastal apartment terrace with sea view at sunset, Costa Blanca, real-estate photography, square composition"
- **stage-before:** "Photorealistic empty unfurnished living room, bare white walls, tiled floor, large window with sea light, real-estate listing photo, wide angle, no furniture"
- **stage-after:** "The same empty living room, now beautifully furnished and styled — sofa, rug, plants, warm light — identical camera angle and framing" (use stage-before as the reference image)
