import type { AgencyRole } from "@/lib/auth/context";

export type NavItem = {
  /** Translation key under the `nav` namespace in messages/<locale>.json. */
  tKey:
    | "overview"
    | "inbox"
    | "properties"
    | "viewings"
    | "performance"
    | "content"
    | "studio"
    | "matches"
    | "settings"
    | "allAgencies";
  href: string;
  iconName:
    | "overview"
    | "inbox"
    | "properties"
    | "viewings"
    | "performance"
    | "content"
    | "studio"
    | "matches"
    | "settings"
    | "admin";
  roles: AgencyRole[];
  /** Render a small "Soon" pill on the nav item (single-line, no wrap). */
  soon?: boolean;
};

/**
 * The five sections of the operator dashboard.
 *
 * Sellers, Network, and Leads are intentionally NOT in the nav anymore: they
 * become surfaces inside Inbox (per the locked design plan). The legacy route
 * files for /leads, /properties, /tasks, /voice, /ads, /sellers, /network
 * remain on disk so any old link survives — they just no longer appear here.
 *
 * Inbox keeps its live count badge. /admin (AIVENA staff) stays separate.
 */
export const PRIMARY_NAV: NavItem[] = [
  { tKey: "overview", href: "/", iconName: "overview", roles: ["owner", "agent", "viewer"] },
  { tKey: "inbox", href: "/approvals", iconName: "inbox", roles: ["owner", "agent", "viewer"] },
  { tKey: "properties", href: "/properties", iconName: "properties", roles: ["owner", "agent", "viewer"] },
  { tKey: "viewings", href: "/viewings", iconName: "viewings", roles: ["owner", "agent", "viewer"] },
  { tKey: "performance", href: "/performance", iconName: "performance", roles: ["owner", "agent", "viewer"] },
  // Content merged into Studio's Library tab (no standalone nav item). /content
  // redirects to /studio.
  { tKey: "studio", href: "/studio", iconName: "studio", roles: ["owner", "agent", "viewer"], soon: true },
  { tKey: "matches", href: "/matches", iconName: "matches", roles: ["owner", "agent", "viewer"], soon: true },
  { tKey: "settings", href: "/settings", iconName: "settings", roles: ["owner", "agent", "viewer"] },
];

export const ADMIN_NAV: NavItem[] = [
  { tKey: "allAgencies", href: "/admin", iconName: "admin", roles: ["aivena_staff"] },
];
