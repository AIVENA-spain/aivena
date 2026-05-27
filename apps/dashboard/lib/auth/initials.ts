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
