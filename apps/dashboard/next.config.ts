import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode floating indicator (route info / bundler /
  // preferences). It overlays the sidebar user widget at the bottom-left and
  // is confusing during pilot screen-share / local-dev with non-developers.
  // Verified against next@16.2.6 type defs — devIndicators accepts `false` to
  // disable the indicator entirely. Has no production effect (dev-only chrome).
  devIndicators: false,
  // Production serves at aivena.es/dashboard behind a rewrite on the landing
  // project (same-origin requirement: Supabase auth redirect URLs + Railway
  // DASHBOARD_URL are registered for that exact origin). Local dev stays at /
  // (env unset). lib/base-path.ts reads the same var for hand-built URLs.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
};

export default withNextIntl(nextConfig);
