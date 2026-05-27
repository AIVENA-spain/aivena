import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { THEME_COOKIE } from "@/lib/i18n/config";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeCookieSync } from "@/components/theme-cookie-sync";
import "./globals.css";

// Inter = UI body, JetBrains Mono = labels/data pills, Instrument Serif (italic)
// = editorial emphasis (big KPI numbers, occasional headings). Wired in
// globals.css via @theme inline so `font-sans` / `font-mono` / `font-serif`
// resolve to these.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aivena · Operator dashboard",
  description: "Aivena operator dashboard.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  // ThemeCookieSync mirrors `next-themes`' resolvedTheme into this cookie so
  // SSR knows which class to apply on first paint — no flash of wrong theme.
  // First-time visitors have no cookie: default to `dark` to match the
  // ThemeProvider's `defaultTheme="dark"`, so the very first render is
  // already on the dark canvas. The client-side ThemeCookieSync writes the
  // cookie on the first frame so subsequent renders stay in sync.
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const htmlClass = themeCookie === "light" ? "" : "dark";

  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${htmlClass} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <ThemeCookieSync />
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
