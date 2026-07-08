import { getLocale, getTranslations } from "next-intl/server";
import { Check, Clock, Globe, Lock, Phone } from "lucide-react";

import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type {
  PerformanceResponse,
  PerfWeeklyReplyTime,
} from "@/lib/api/types";

// ---------- formatting helpers ----------

function humanizeSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec === 0 ? `${m}m` : `${m}m ${sec}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h ${m}m`;
}

const DAY_MONTH = { day: "numeric", month: "short", timeZone: "UTC" } as const;

function formatRange(from: string, to: string, locale: string): string {
  // Intl.formatRange handles same-month collapse ("May 25 – 28" / "25–28 may"),
  // day/month order, and month casing per-locale; cross-month falls back to the
  // full form ("May 28 – Jun 3"). No hardcoded month names.
  return new Intl.DateTimeFormat(locale, DAY_MONTH).formatRange(
    new Date(from),
    new Date(to),
  );
}

// ---------- duration number (dims the unit letters) ----------

function DurationNum({ text }: { text: string }) {
  const parts = text.split(/(\d+)/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        /\d/.test(p) ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="text-[18px] font-medium text-muted-foreground">
            {p}
          </span>
        ),
      )}
    </>
  );
}

// ---------- charts (hand-rolled SVG, green data series) ----------

function AreaChart({
  series,
  labels,
  emptyLabel,
}: {
  series: number[];
  labels: string[];
  emptyLabel: string;
}) {
  const W = 600;
  const H = 180;
  const grid = [45, 90, 135];
  const max = series.length ? Math.max(...series) : 0;

  if (series.length === 0 || max === 0) {
    return (
      <div className="relative h-[180px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[180px] w-full overflow-visible"
        >
          {grid.map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2={W}
              y2={y}
              style={{ stroke: "var(--border)" }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[12.5px] text-muted-foreground">
            {emptyLabel}
          </span>
        </div>
      </div>
    );
  }

  const n = series.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => 160 - (v / max) * 120;
  const line = "M" + series.map((v, i) => `${x(i)},${y(v)}`).join(" L");
  const area = `${line} L${x(n - 1)},${H} L${x(0)},${H} Z`;
  const peakIdx = series.indexOf(max);

  return (
    <div className="relative h-[180px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[180px] w-full overflow-visible"
      >
        <defs>
          <linearGradient id="perf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {grid.map((yy) => (
          <line
            key={yy}
            x1="0"
            y1={yy}
            x2={W}
            y2={yy}
            style={{ stroke: "var(--border)" }}
          />
        ))}
        <path d={area} fill="url(#perf-area)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2.5} />
        {peakIdx >= 0 ? (
          <circle
            cx={x(peakIdx)}
            cy={y(max)}
            r={4.5}
            fill="var(--brand)"
            strokeWidth={2}
            style={{ stroke: "var(--card)" }}
          />
        ) : null}
      </svg>
      <div className="absolute right-0 -bottom-1 left-0 flex justify-between font-mono text-[10px] text-muted-foreground/70">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function LineChart({
  points,
}: {
  points: { label: string; value: number | null }[];
}) {
  const W = 360;
  const H = 180;
  const grid = [45, 90, 135];
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => v != null);
  const max = values.length ? Math.max(...values) : 0;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => (max === 0 ? H / 2 : 160 - (v / max) * 120);

  const segs: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].value;
    const b = points[i + 1].value;
    if (a != null && b != null) {
      segs.push(`M${x(i)},${y(a)} L${x(i + 1)},${y(b)}`);
    }
  }
  let latestIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (points[i].value != null) {
      latestIdx = i;
      break;
    }
  }

  return (
    <div className="relative h-[180px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[180px] w-full overflow-visible"
      >
        {grid.map((yy) => (
          <line
            key={yy}
            x1="0"
            y1={yy}
            x2={W}
            y2={yy}
            style={{ stroke: "var(--border)" }}
          />
        ))}
        {segs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--brand)" strokeWidth={2.5} />
        ))}
        {latestIdx >= 0 ? (
          <circle
            cx={x(latestIdx)}
            cy={y(points[latestIdx].value as number)}
            r={4.5}
            fill="var(--brand)"
            strokeWidth={2}
            style={{ stroke: "var(--card)" }}
          />
        ) : null}
      </svg>
      <div className="absolute right-0 -bottom-1 left-0 flex justify-between font-mono text-[10px] text-muted-foreground/70">
        {points.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- shells ----------

function KpiCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-[18px] shadow-elevated">
      {children}
    </div>
  );
}

function KpiLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Check;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
      <Icon className="h-[15px] w-[15px] opacity-70" aria-hidden strokeWidth={2} />
      {children}
    </div>
  );
}

function Panel({
  heading,
  tag,
  take,
  children,
}: {
  heading: string;
  tag?: React.ReactNode;
  take: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-elevated">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {heading}
        </h3>
        {tag ? <span className="shrink-0">{tag}</span> : null}
      </div>
      <p className="mb-4 text-[12.5px] leading-[1.5] text-muted-foreground">
        {take}
      </p>
      {children}
    </section>
  );
}

// ---------- workspace ----------

export async function PerformanceWorkspace({
  data,
}: {
  data: PerformanceResponse;
}) {
  const t = await getTranslations("performance");
  const locale = intlLocaleFor(await getLocale());
  const nf = new Intl.NumberFormat(locale);

  const takeEm = {
    em: (chunks: React.ReactNode) => (
      <span className="font-medium text-foreground">{chunks}</span>
    ),
  };

  const la = data.kpis.leads_answered;
  const ar = data.kpis.avg_reply;
  const langs = data.kpis.languages;
  const rec = data.recovered_leads;
  const mcr = data.missed_call_recovery;

  // Sparkbar (KPI 1)
  const sparkMax = data.daily_answered.length
    ? Math.max(...data.daily_answered.map((d) => d.answered_count))
    : 0;

  // Area chart series + day-of-week labels
  const areaSeries = data.daily_answered.map((d) => d.answered_count);
  const areaLabels = data.daily_answered.map((d) =>
    new Date(d.date).toLocaleDateString(locale, {
      weekday: "short",
      timeZone: "UTC",
    }),
  );

  // Line chart points (segments drawn only between adjacent non-null weeks)
  const weekLabel = (w: PerfWeeklyReplyTime) =>
    new Date(w.week_start).toLocaleDateString(locale, DAY_MONTH);
  const linePoints = data.weekly_reply_time.map((w) => ({
    label: weekLabel(w),
    value: w.median_seconds,
  }));
  const weeksWithData = data.weekly_reply_time.filter(
    (w) => w.median_seconds != null,
  ).length;
  const totalWeeks = data.weekly_reply_time.length;

  // Language bars (top 5 non-unknown) + honest "unknown" footnote
  const nonUnknown = data.language_breakdown.filter(
    (l) => l.language !== "unknown",
  );
  const topLangs = nonUnknown.slice(0, 5);
  const langMax = topLangs.length
    ? Math.max(...topLangs.map((l) => l.count))
    : 0;
  const unknownCount =
    data.language_breakdown.find((l) => l.language === "unknown")?.count ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Range pill */}
      <div className="flex justify-end">
        <span className="rounded-[10px] border border-border px-3 py-2 font-mono text-[12px] text-muted-foreground">
          {formatRange(data.range.from, data.range.to, locale)}
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1 — Leads answered */}
        <KpiCard>
          <KpiLabel icon={Check}>{t("kpiLeadsAnswered")}</KpiLabel>
          <div className="font-mono text-[32px] font-semibold leading-none tracking-[-0.02em] text-foreground">
            {la.total === 0 ? (
              <span className="text-muted-foreground/60">—</span>
            ) : (
              <>
                {nf.format(Math.round(la.pct))}
                <span className="text-[18px] font-medium text-muted-foreground">
                  %
                </span>
              </>
            )}
          </div>
          {la.total > 0 ? (
            <div className="mt-3 flex h-[26px] items-end gap-[3px]">
              {data.daily_answered.map((d, i) => {
                const isZero = d.answered_count === 0;
                const h =
                  sparkMax > 0 && !isZero
                    ? Math.max((d.answered_count / sparkMax) * 100, 12)
                    : 12;
                return (
                  <span
                    key={i}
                    className="flex-1 rounded-t-[2px]"
                    style={{
                      height: `${h}%`,
                      background: "var(--brand)",
                      opacity: isZero ? 0.18 : 0.85,
                    }}
                  />
                );
              })}
            </div>
          ) : null}
          <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {la.total === 0 ? (
              <span>{t("noLeadsYet")}</span>
            ) : (
              <>
                <span>{t("ofTotal", { count: la.count, total: la.total })}</span>
                <span aria-hidden>·</span>
                {la.prior.total > 0 && la.delta_pp != null ? (
                  <span
                    className="inline-flex items-center gap-0.5 font-semibold"
                    style={{
                      color:
                        la.delta_pp >= 0
                          ? "var(--brand)"
                          : "var(--muted-foreground)",
                    }}
                  >
                    {la.delta_pp >= 0 ? "▲" : "▼"}{" "}
                    {Math.abs(Math.round(la.delta_pp))}pp
                  </span>
                ) : (
                  <span>{t("noPriorWeek")}</span>
                )}
              </>
            )}
          </div>
        </KpiCard>

        {/* KPI 2 — Avg reply time */}
        <KpiCard>
          <KpiLabel icon={Clock}>{t("kpiAvgReply")}</KpiLabel>
          <div className="font-mono text-[32px] font-semibold leading-none tracking-[-0.02em] text-foreground">
            {ar.median_seconds == null ? (
              <span className="text-muted-foreground/60">—</span>
            ) : (
              <DurationNum text={humanizeSeconds(ar.median_seconds)} />
            )}
          </div>
          <div className="mt-3 font-mono text-[11px] text-muted-foreground">
            {ar.median_seconds == null ? (
              <span>{t("noRepliesYet")}</span>
            ) : ar.delta_seconds == null ? (
              <span>{t("medianOfSampleWeek", { n: ar.sample_n })}</span>
            ) : (
              <>
                <span
                  className="inline-flex items-center gap-0.5 font-semibold"
                  style={{
                    color:
                      ar.delta_seconds < 0
                        ? "var(--brand)"
                        : "var(--muted-foreground)",
                  }}
                >
                  {ar.delta_seconds < 0 ? "▼" : "▲"}{" "}
                  {humanizeSeconds(Math.abs(ar.delta_seconds))}{" "}
                  {ar.delta_seconds < 0 ? t("faster") : t("slower")}
                </span>{" "}
                {t("vsLastWeek")}
              </>
            )}
          </div>
        </KpiCard>

        {/* KPI 3 — Calls recovered (honest-empty, gated on Voice) */}
        <KpiCard>
          {rec.no_source || rec.value == null ? (
            <span className="absolute top-3.5 right-3.5 rounded-full border border-border px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-muted-foreground/70">
              {t("voiceSoon")}
            </span>
          ) : null}
          <KpiLabel icon={Phone}>{t("kpiCallsRecovered")}</KpiLabel>
          <div className="font-mono text-[32px] font-semibold leading-none tracking-[-0.02em] text-muted-foreground/60">
            {rec.no_source || rec.value == null ? "—" : nf.format(rec.value)}
          </div>
          <div className="mt-3 font-mono text-[11px] text-muted-foreground">
            {t("activatesWithVoice")}
          </div>
        </KpiCard>

        {/* KPI 4 — Languages used */}
        <KpiCard>
          <KpiLabel icon={Globe}>{t("kpiLanguagesUsed")}</KpiLabel>
          <div className="font-mono text-[32px] font-semibold leading-none tracking-[-0.02em] text-foreground">
            {nf.format(langs.distinct)}
          </div>
          <div className="mt-3 font-mono text-[11px] lowercase text-muted-foreground">
            {langs.distinct === 0 ? "—" : langs.list.join(" · ")}
          </div>
        </KpiCard>
      </div>

      {/* Chart row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          heading={t("leadsOverTimeHeading")}
          tag={
            <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground/70">
              {t("thisWeekTag")}
            </span>
          }
          take={t.rich("leadsOverTimeTake", takeEm)}
        >
          <AreaChart
            series={areaSeries}
            labels={areaLabels}
            emptyLabel={t("noRepliesCharted")}
          />
        </Panel>

        <Panel
          heading={t("responseTrendHeading")}
          tag={
            weeksWithData < totalWeeks ? (
              <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground/70">
                {t("weeksHaveData", { n: weeksWithData, total: totalWeeks })}
              </span>
            ) : undefined
          }
          take={t.rich("responseTrendTake", takeEm)}
        >
          <LineChart points={linePoints} />
        </Panel>
      </div>

      {/* Languages + missed-call row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          heading={t("languagesHeading")}
          tag={
            <span
              className="font-mono text-[9.5px] tracking-[0.1em]"
              style={{ color: "var(--brand)" }}
            >
              {t("multilingualMoat")}
            </span>
          }
          take={t.rich("languagesTake", takeEm)}
        >
          {topLangs.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {t("noLanguagesYet")}
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex flex-col gap-3.5">
                {topLangs.map((l) => (
                  <div
                    key={l.language}
                    className="grid grid-cols-[34px_1fr_28px] items-center gap-3"
                  >
                    <span className="font-mono text-[12px] font-medium uppercase text-foreground">
                      {l.language}
                    </span>
                    <span className="h-[9px] overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${langMax > 0 ? (l.count / langMax) * 100 : 0}%`,
                          background: "var(--brand)",
                        }}
                      />
                    </span>
                    <span className="text-right font-mono text-[12px] text-muted-foreground">
                      {nf.format(l.count)}
                    </span>
                  </div>
                ))}
              </div>
              {unknownCount > 0 ? (
                <p className="mt-3.5 font-mono text-[10.5px] text-muted-foreground/70">
                  · {t("unknownFootnote", { n: unknownCount })}
                </p>
              ) : null}
            </>
          )}
        </Panel>

        <Panel
          heading={t("missedCallHeading")}
          take={t("missedCallTake")}
        >
          {mcr.no_source || mcr.value == null ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-border bg-muted/20 px-4 py-3.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden strokeWidth={2} />
              </span>
              <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                {t.rich("missedCallEmpty", {
                  b: (chunks) => (
                    <strong className="font-semibold text-foreground">
                      {chunks}
                    </strong>
                  ),
                })}
              </p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
