import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { ADMIN_BASE_PATH } from "@/lib/base-path";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "GigaPDF Admin",
    template: "%s | GigaPDF Admin",
  },
  description: "Super admin dashboard for GigaPDF",
  icons: {
    icon: [
      { url: `${ADMIN_BASE_PATH}/favicon.ico`, sizes: "any" },
      { url: `${ADMIN_BASE_PATH}/favicon-16x16.png`, sizes: "16x16", type: "image/png" },
      { url: `${ADMIN_BASE_PATH}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: `${ADMIN_BASE_PATH}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" },
    ],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children as React.ReactNode}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
