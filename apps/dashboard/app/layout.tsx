import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { THEME_COOKIE } from "@/lib/i18n/config";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeCookieSync } from "@/components/theme-cookie-sync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  // For first-time visitors the cookie is absent; next-themes' own inline
  // script then resolves before paint.
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const htmlClass = themeCookie === "dark" ? "dark" : "";

  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${htmlClass} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
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
