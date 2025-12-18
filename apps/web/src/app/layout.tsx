import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

// Force dynamic rendering for all pages
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "GigaPDF - Professional PDF Editor",
    template: "%s | GigaPDF",
  },
  description: "A powerful WYSIWYG PDF editing platform with real-time collaboration",
  keywords: ["PDF", "editor", "WYSIWYG", "collaboration", "documents"],
};

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
