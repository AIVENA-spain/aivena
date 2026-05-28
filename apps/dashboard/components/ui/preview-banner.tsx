// Shared "coming soon" preview banner: green diagonal-stripe background, a
// signal-green status dot, a JetBrains-Mono label, and an optional muted note
// on the right. Used on watermarked-demo surfaces (Content now; Network can
// adopt it). The stripe + dot use the literal signal green (#1FE874) on
// purpose — they're fixed signal accents, legible on both light and dark
// canvases — while the text uses theme tokens so it inverts in dark mode.
export function PreviewBanner({
  label,
  note,
}: {
  label: string;
  note?: string;
}) {
  return (
    <div
      className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-brand/40 px-4 py-3"
      style={{
        background:
          "repeating-linear-gradient(135deg, rgba(31,232,116,0.10) 0 10px, rgba(31,232,116,0.03) 10px 20px)",
      }}
    >
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#1FE874]"
        style={{ boxShadow: "0 0 0 4px rgba(31,232,116,0.25)" }}
        aria-hidden
      />
      <span className="font-mono text-[11.5px] font-medium tracking-[0.14em] text-foreground">
        {label}
      </span>
      {note ? (
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  );
}
