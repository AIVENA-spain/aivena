// ── the single definition of "a photo we can actually load" ───────────────────
//
// WHY THIS EXISTS
// montinmo.es — the source ~57% of the demo catalog hotlinked its photos from — went away for good
// (DNS resolves, every connection refused; confirmed 2026-07-14 from Railway, a dev machine and a
// browser). 81 of the demo's 141 properties lost every photo they had, and those images can never be
// re-fetched. That was the entire cause of "preview failed" in the Studio templates gallery.
//
// The first fix was a montinmo-specific blocklist inside the Studio. That is reactive by nature: it
// only knows about montinmo because a human diagnosed montinmo *after* broken photos reached the
// product, and it cannot catch the next host that dies. Meanwhile the readiness code had already
// arrived at a better rule for its `with_hotlinked_images` signal — a photo counts only if we serve
// it ourselves — leaving the codebase with two competing definitions of "bad image".
//
// This module is that better rule, stated once, so every surface agrees:
//
//   A photo is usable only if we serve it from our own property-images storage bucket.
//
// It is a positive test (do we own it?) rather than a negative one (is it on a host we happen to know
// is dead?), so a host dying in future needs no code change — an image we never owned was never
// counted usable in the first place. Verified 2026-07-14: this rule and the old montinmo blocklist
// return IDENTICAL results across the entire live catalog (same 60 usable, same 81 unusable, zero
// properties where they disagree), so adopting it changes no behaviour today.
//
// DELIBERATE TRADE-OFF: this is stricter than a blocklist — it also rejects images on a *live*
// third-party host. That costs nothing today (the catalog contains exactly two hosts: our storage,
// and dead montinmo), but it means feed ingestion must MIRROR images into our bucket rather than
// store the feed's links. That is the correct outcome: storing someone else's links is precisely
// what made montinmo able to take 57% of the catalog down with it.
//
// This module makes NO judgement about what a surface should DO with a photoless property — hiding
// it, showing a "no photo" state, or excluding it from a render is the caller's decision.

/** Path fragment identifying an image served from our own public property-images bucket. */
export const OWNED_STORAGE_MARKER = '/storage/v1/object/public/property-images/';

/** SQL LIKE pattern for the same test, so SQL and TS can never drift apart. */
export const OWNED_STORAGE_LIKE = `%${OWNED_STORAGE_MARKER}%`;

/** True only for a non-empty URL string served from our own storage. */
export function isUsablePhotoUrl(u: unknown): u is string {
  return typeof u === 'string' && u.trim().length > 0 && u.includes(OWNED_STORAGE_MARKER);
}

/**
 * The usable photos of a property, in order. Accepts the raw `properties.images` jsonb value
 * (which may be null, a non-array, or contain junk) and never throws.
 */
export function usablePhotos(images: unknown): string[] {
  return (Array.isArray(images) ? images : []).filter(isUsablePhotoUrl);
}

/** Whether a property has at least one photo we can actually load. */
export function hasUsablePhoto(images: unknown): boolean {
  return usablePhotos(images).length > 0;
}

/**
 * Photo counts for a property — for surfaces that want to say "no photo" honestly, or report how
 * many of a listing's images are unreachable (e.g. an agency's "fix these" list).
 */
export function photoCounts(images: unknown): { total: number; usable: number; unusable: number } {
  const all = Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u.trim().length > 0) : [];
  const usable = all.filter(isUsablePhotoUrl).length;
  return { total: all.length, usable, unusable: all.length - usable };
}
