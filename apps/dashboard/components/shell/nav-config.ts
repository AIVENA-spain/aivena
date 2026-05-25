import type { AgencyRole } from "@/lib/auth/context";

export type NavItem = {
  /** Translation key under the `nav` namespace in messages/<locale>.json. */
  tKey:
    | "overview"
    | "approvals"
    | "leads"
    | "inbox"
    | "properties"
    | "tasks"
    | "voice"
    | "ads"
    | "team"
    | "settings"
    | "allAgencies";
  href: string;
  iconName:
    | "home"
    | "approvals"
    | "users"
    | "inbox"
    | "building"
    | "check"
    | "phone"
    | "megaphone"
    | "team"
    | "settings"
    | "shield";
  roles: AgencyRole[];
};

export const PRIMARY_NAV: NavItem[] = [
  { tKey: "overview", href: "/", iconName: "home", roles: ["owner", "agent", "viewer"] },
  { tKey: "approvals", href: "/approvals", iconName: "approvals", roles: ["owner", "agent"] },
  { tKey: "leads", href: "/leads", iconName: "users", roles: ["owner", "agent", "viewer"] },
  { tKey: "inbox", href: "/inbox", iconName: "inbox", roles: ["owner", "agent", "viewer"] },
  { tKey: "properties", href: "/properties", iconName: "building", roles: ["owner", "agent", "viewer"] },
  { tKey: "tasks", href: "/tasks", iconName: "check", roles: ["owner", "agent"] },
  { tKey: "voice", href: "/voice", iconName: "phone", roles: ["owner", "agent"] },
  { tKey: "ads", href: "/ads", iconName: "megaphone", roles: ["owner", "agent"] },
  { tKey: "team", href: "/settings/team", iconName: "team", roles: ["owner"] },
  { tKey: "settings", href: "/settings", iconName: "settings", roles: ["owner", "agent", "viewer"] },
];

export const ADMIN_NAV: NavItem[] = [
  { tKey: "allAgencies", href: "/admin", iconName: "shield", roles: ["aivena_staff"] },
];
