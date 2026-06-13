import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Toaster } from "@giga-pdf/ui";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

// Plus de force-dynamic global : le rendu dynamique est désormais déclaré
// explicitement par les segments qui l'exigent ((dashboard), editor, embed).
// Les pages publiques sous [locale] restent libres d'être prérendues.

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

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
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://giga-pdf.com";

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
    authors: [{ name: "GigaPDF", url: baseUrl }],
    creator: "GigaPDF",
    publisher: "GigaPDF",
    metadataBase: new URL(baseUrl),
    // Pas de hreflang : le routing next-intl est par cookie (une seule URL
    // par page) — /fr et /en n'existent pas et renvoyaient 404 aux crawlers.
    // À réintroduire seulement si un routing par préfixe de locale est ajouté.
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      alternateLocale: "en_US",
      url: baseUrl,
      siteName: "GigaPDF",
      title: t("ogTitle"),
      description: t("ogDescription"),
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "GigaPDF - Open Source PDF Editor",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t("twitterTitle"),
      description: t("twitterDescription"),
      images: ["/og.png"],
      creator: "@gigapdf",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
