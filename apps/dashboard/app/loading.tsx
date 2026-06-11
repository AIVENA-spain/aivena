/**
 * Root loading state — covers cold/hard loads where the (app) layout itself is
 * still fetching (user context + settings). A calm branded pulse instead of a
 * blank tab.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-foreground text-[15px] font-bold text-brand">
          A
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          AIVENA
        </span>
      </div>
    </div>
  );
}
