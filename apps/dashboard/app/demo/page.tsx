import type { Metadata } from "next";

import { DemoClient } from "./demo-client";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "AIVENA — dashboard demo",
  description: "Interactive demo of the AIVENA operator dashboard (sample data).",
};

/**
 * Public, no-auth, fixture-only demo of the real dashboard for the landing
 * page (embedded via iframe). Lives OUTSIDE the (app) auth perimeter so it
 * never touches Supabase, auth, or real data. Everything is static fixtures.
 */
export default function DemoPage() {
  return <DemoClient />;
}
