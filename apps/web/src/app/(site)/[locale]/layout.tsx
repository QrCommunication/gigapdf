import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Toaster } from "@giga-pdf/ui";
import { Providers } from "@/components/providers";
import { routing } from "@/i18n/routing";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// ROOT LAYOUT #1 — périmètre PUBLIC localisé ((site)/[locale]/*).
//
// C'est un VRAI root layout (rend <html>/<body>) : il n'existe plus de
// app/layout.tsx. Les deux groupes (site) et (app) portent chacun leur propre
// root layout (pattern officiel Next.js « multiple root layouts » pour une app
// mixte localisée par URL / résolue par cookie).
//
// Statique par construction : AUCUN cookies()/getLocale() ici. La locale vient
// EXCLUSIVEMENT du segment [locale] (params), donc generateStaticParams +
// setRequestLocale suffisent à pré-rendre tout le périmètre public en SSG.
// ---------------------------------------------------------------------------

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

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** Pré-rendu statique des deux locales (fr, en). */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Défense en profondeur : refuse les valeurs de [locale] hors fr/en. Le root
 * layout étant désormais STATIQUE (locale issue de params, pas du cookie),
 * Next honore ce flag → un segment inconnu (/xx/...) donne un vrai 404 natif.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const { locale } = await params;
  // setRequestLocale ici aussi : generateMetadata s'exécute hors du flux de
  // rendu du layout, getTranslations a besoin du contexte de locale statique.
  setRequestLocale(locale);

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
    // hreflang par défaut du périmètre bilingue (landing `/` ↔ `/en`). Les
    // pages qui définissent leurs propres `alternates` (auth, legal, seo)
    // écrasent intégralement ce bloc (merge shallow de Metadata).
    alternates: {
      canonical: locale === "en" ? "/en" : "/",
      languages: {
        fr: "/",
        en: "/en",
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      locale: locale === "en" ? "en_US" : "fr_FR",
      alternateLocale: locale === "en" ? "fr_FR" : "en_US",
      url: locale === "en" ? `${baseUrl}/en` : baseUrl,
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

export default async function SiteLocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  // messages/ est à apps/web/messages/ (sibling de src/). Depuis
  // src/app/(site)/[locale]/ : remonter (site) → app → src → web.
  const messages = (await import(`../../../../messages/${locale}.json`)).default;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
