import type { AgencyRole } from "@/lib/auth/context";

export type NavItem = {
  /** Translation key under the `nav` namespace in messages/<locale>.json. */
  tKey:
    | "overview"
    | "inbox"
    | "performance"
    | "content"
    | "settings"
    | "allAgencies";
  href: string;
  iconName:
    | "overview"
    | "inbox"
    | "performance"
    | "content"
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
  { tKey: "performance", href: "/performance", iconName: "performance", roles: ["owner", "agent", "viewer"] },
  { tKey: "content", href: "/content", iconName: "content", roles: ["owner", "agent", "viewer"], soon: true },
  { tKey: "settings", href: "/settings", iconName: "settings", roles: ["owner", "agent", "viewer"] },
];

export const ADMIN_NAV: NavItem[] = [
  { tKey: "allAgencies", href: "/admin", iconName: "admin", roles: ["aivena_staff"] },
];
