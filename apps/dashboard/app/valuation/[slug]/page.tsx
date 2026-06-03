import { ValuationForm } from "./valuation-form";

export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated valuation widget (W19, v1.14.6). Slug-resolved per
 * agency (mirrors the planned /chat/:agencySlug pattern) and deliberately
 * OUTSIDE the (app) auth perimeter — no JWT, no RLS — so it can be embedded on
 * the agency's own website. Agency branding resolution from the slug is wired
 * when the capture endpoint lands; for now the slug is shown as the agency
 * label so the shell is honest about what it is.
 */
export default async function ValuationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brandName = prettifySlug(slug);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <ValuationForm brandName={brandName} />
    </main>
  );
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
