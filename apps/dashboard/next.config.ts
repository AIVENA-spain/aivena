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
};

export default withNextIntl(nextConfig);
