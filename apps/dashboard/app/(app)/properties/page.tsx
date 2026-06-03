import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { apiFetch, ApiError } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";
import { PageLoadError } from "@/components/shell/page-error";
import { buttonVariants } from "@/components/ui/button";
import type { PropertiesResponse, PropertyRow } from "@/lib/api/types";

export const dynamic = "force-dynamic";

/**
 * Properties — the agency's promoted catalog (§5.17). Read-only list; the CSV
 * import lives in Settings → Properties. Honest empty state when the catalog
 * has no rows yet (Law 1).
 */
export default async function PropertiesPage() {
  const t = await getTranslations("properties");

  const ctx = await getCurrentUserContext();
  const agencyId = ctx?.activeAgency?.agencyId ?? null;
  if (!agencyId) return <PageLoadError />;

  let rows: PropertyRow[] = [];
  try {
    const res = await apiFetch<PropertiesResponse>(
      `/api/v1/agencies/${encodeURIComponent(agencyId)}/properties`,
    );
    rows = res.properties;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/properties] load failed:", detail);
    return <PageLoadError />;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link
          href="/settings#properties"
          className={buttonVariants({ size: "sm" })}
        >
          {t("importCta")}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyBody")}</p>
          <Link
            href="/settings#properties"
            className={`${buttonVariants({ size: "sm" })} mt-4`}
          >
            {t("importCta")}
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("colRef")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colTitle")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colType")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colLocation")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("colPrice")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">
                    {p.external_id}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{p.title}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {p.property_type ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {[p.location_city, p.location_region]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">
                    {p.price === null
                      ? "—"
                      : `${p.price.toLocaleString()} ${p.price_currency}`}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={p.status} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: Awaited<ReturnType<typeof getTranslations<"properties">>>;
}) {
  const known = ["active", "reserved", "sold"].includes(status);
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
      {known ? t(("status_" + status) as StatusKey) : status}
    </span>
  );
}

type StatusKey = "status_active" | "status_reserved" | "status_sold";
