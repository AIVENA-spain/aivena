export function PageStub({
  title,
  description,
  comingSoonText = "Coming soon.",
}: {
  title: string;
  description?: string;
  comingSoonText?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{comingSoonText}</p>
      </div>
    </div>
  );
}
