import type { UserContext } from "./context";

// Returns the avatar initial for the current user.
// TODO(post-pilot): when `user_preferences.display_name` (or equivalent
// full-name field) lands and Settings has a Display Name input, prefer
// that source and return first+last initial (e.g. "CS"). One helper,
// one upgrade path. Do not add fallback logic before that lands —
// mixing sources produces inconsistent initials across accounts.
export function userInitial(ctx: UserContext): string {
  return ctx.email[0]?.toUpperCase() ?? "?";
}

/**
 * First-letter initial from an email, uppercased. Single letter on purpose:
 * the sidebar account chip and the Team & Access member rows both use this,
 * and 1-character avatars read cleaner than 2-character at the chip's size
 * than mixed-length avatars (christian → "C", agent.test → "A" rather than
 * "CS" / "AT"). Falls back to "?" only when the email is somehow empty.
 */
export function emailInitial(email: string): string {
  const head = email.split("@")[0] ?? "";
  return (head[0] ?? "?").toUpperCase();
}
