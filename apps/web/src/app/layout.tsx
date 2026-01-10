import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

// Force dynamic rendering for all pages
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"] });

const appIcons = {
  icon: [
    { url: "/favicon.ico", sizes: "any" },
    { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
  ],
  apple: [
    { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: {
      default: t("title.default"),
      template: t("title.template"),
    },
    description: t("description"),
    keywords: t("keywords")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    icons: appIcons,
    manifest: "/manifest.json",
  };
}

export default async function RootLayout(props: {
  children?: React.ReactNode;
}) {
  const { children } = props;
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
