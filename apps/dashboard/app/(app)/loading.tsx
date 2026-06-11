/**
 * Shared loading state for every (app) page slot. Renders the instant a
 * navigation starts (the sidebar/topbar shell stays put), so switching pages
 * paints immediately while the page's data streams in — instead of the router
 * appearing frozen until the full RSC payload lands.
 */
export default function AppLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true">
      <div className="h-7 w-44 rounded-md bg-muted/70" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[2fr_1fr]">
        <div className="h-72 rounded-xl border border-border bg-card" />
        <div className="h-72 rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}
