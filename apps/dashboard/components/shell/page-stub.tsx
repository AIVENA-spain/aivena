import { getTranslations } from "next-intl/server";

export async function PageStub({
  title,
  description,
  comingSoonText,
}: {
  title: string;
  description?: string;
  comingSoonText?: string;
}) {
  const t = await getTranslations("stub");
  const coming = comingSoonText ?? t("comingSoon");

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
        <p className="text-sm text-muted-foreground">{coming}</p>
      </div>
    </div>
  );
}
