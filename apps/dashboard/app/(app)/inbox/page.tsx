import { getTranslations } from "next-intl/server";

import { PageStub } from "@/components/shell/page-stub";

export default async function InboxPage() {
  const t = await getTranslations("nav");
  return <PageStub title={t("inbox")} />;
}
