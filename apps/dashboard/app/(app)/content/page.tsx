import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { PreviewBanner } from "@/components/ui/preview-banner";

export const dynamic = "force-dynamic";

/**
 * Content — a clearly-watermarked preview of the Generate pillar's output
 * (AI-written social posts + ad creative the agency posts itself). Law 1
 * permits a watermarked demo here (as on Network): nothing on this page is
 * live, fetched, or published — all sample copy is hardcoded i18n.
 */
const SAMPLE_CARDS = [
  {
    key: "instagram",
    gradient: "linear-gradient(135deg,#7FB8E8 0%,#9FD6C0 55%,#BCE8C2 100%)",
  },
  {
    key: "facebook",
    gradient: "linear-gradient(135deg,#F2C879 0%,#E9A98A 50%,#9FD6B0 100%)",
  },
  {
    key: "metaAd",
    gradient: "linear-gradient(135deg,#B6A7E8 0%,#9AA6E0 60%,#C7B6F0 100%)",
  },
] as const;

export default async function ContentPage() {
  const t = await getTranslations("content");

  return (
    <div className="flex flex-col">
      {/* Watermark / coming-soon banner */}
      <PreviewBanner label={t("bannerLabel")} note={t("bannerNote")} />

      {/* Recent drafts heading */}
      <div className="mt-8 mb-4 flex items-baseline justify-between px-0.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {t("draftsHeading")}
        </h2>
        <span className="font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground/70">
          {t("draftsNote")}
        </span>
      </div>

      {/* Sample cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {SAMPLE_CARDS.map((card) => (
          <article
            key={card.key}
            className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-elevated transition-transform duration-200 hover:-translate-y-[3px] hover:shadow-2xl"
          >
            {/* Gradient "art" — fixed pastel artwork, same in both themes */}
            <div
              className="relative flex h-[172px] items-end p-3.5"
              style={{ background: card.gradient }}
            >
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span
                  className="font-mono text-[18px] font-medium tracking-[0.34em] text-white/60"
                  style={{
                    transform: "rotate(-18deg)",
                    textShadow: "0 1px 2px rgba(0,0,0,0.12)",
                  }}
                >
                  {t("sampleTag")}
                </span>
              </div>
              <span className="rounded-full bg-white/80 px-2.5 py-[5px] font-mono text-[10px] font-medium tracking-[0.1em] text-[#10131A] backdrop-blur-sm">
                {t(`cards.${card.key}.platform`)}
              </span>
            </div>

            <div className="px-4 pt-4 pb-[17px]">
              <h3 className="mb-[7px] text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
                {t(`cards.${card.key}.title`)}
              </h3>
              <p className="text-[13px] leading-[1.55] text-muted-foreground">
                {t(`cards.${card.key}.body`)}
              </p>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <span className="rounded-full border border-border px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground/70">
                  {t("sampleTag")}
                </span>
                <span className="ml-auto text-[12px] font-medium text-muted-foreground/70">
                  {t("draftedInVoice")}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Generate strip — teaser, non-functional */}
      <div className="mt-[30px] flex flex-col items-start gap-5 rounded-xl border border-dashed border-border bg-card/50 px-6 py-[22px] sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-foreground text-brand">
          <Sparkles className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 className="mb-1 text-[15px] font-semibold text-foreground">
            {t("generateHeading")}
          </h4>
          <p className="max-w-[680px] text-[13px] leading-[1.55] text-muted-foreground">
            {t.rich("generateBody", {
              em: (chunks) => (
                <em className="font-serif text-[15px] italic text-foreground">
                  {chunks}
                </em>
              ),
            })}
          </p>
        </div>
        <button
          type="button"
          disabled
          aria-disabled
          className="flex flex-none cursor-not-allowed items-center gap-2 rounded-[10px] bg-primary px-[18px] py-[11px] text-[13px] font-semibold text-primary-foreground opacity-90 sm:ml-auto"
        >
          {t("generateButton")}
          <span className="rounded-full border border-brand/50 px-1.5 py-[2px] font-mono text-[9px] tracking-[0.06em] text-brand">
            {t("generateSoon")}
          </span>
        </button>
      </div>

      {/* Explainer */}
      <p className="mt-[26px] max-w-[760px] text-[13px] leading-[1.6] text-muted-foreground">
        {t.rich("explainer", {
          strong: (chunks) => (
            <strong className="font-semibold text-foreground">{chunks}</strong>
          ),
        })}
      </p>
    </div>
  );
}
