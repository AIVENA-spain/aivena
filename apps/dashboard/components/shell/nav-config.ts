import type { AgencyRole } from "@/lib/auth/context";

export type NavItem = {
  label: string;
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
  { label: "Overview", href: "/", iconName: "home", roles: ["owner", "agent", "viewer"] },
  { label: "Approvals", href: "/approvals", iconName: "approvals", roles: ["owner", "agent"] },
  { label: "Leads", href: "/leads", iconName: "users", roles: ["owner", "agent", "viewer"] },
  { label: "Inbox", href: "/inbox", iconName: "inbox", roles: ["owner", "agent", "viewer"] },
  { label: "Properties", href: "/properties", iconName: "building", roles: ["owner", "agent", "viewer"] },
  { label: "Tasks", href: "/tasks", iconName: "check", roles: ["owner", "agent"] },
  { label: "Voice", href: "/voice", iconName: "phone", roles: ["owner", "agent"] },
  { label: "Ads", href: "/ads", iconName: "megaphone", roles: ["owner", "agent"] },
  { label: "Team", href: "/settings/team", iconName: "team", roles: ["owner"] },
  { label: "Settings", href: "/settings", iconName: "settings", roles: ["owner"] },
];

export const ADMIN_NAV: NavItem[] = [
  { label: "All Agencies", href: "/admin", iconName: "shield", roles: ["aivena_staff"] },
];
