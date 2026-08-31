/** The four colours a deck wears — main / accent / paper (the beige) / ink (the black). They map
 *  onto the engine's navy / gold / cream / text. Kept out of wizard-actions.ts because a
 *  "use server" module may only export async functions, and the directive has to be its first
 *  statement. */
export type SlotColours = { main?: string; accent?: string; paper?: string; ink?: string };
