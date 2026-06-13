import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Défense en profondeur : refuse les valeurs de [locale] hors fr/en.
 * NB : en rendu DYNAMIQUE (root layout cookie-résolu), Next n'honore pas
 * toujours ce flag — la garde EFFECTIVE des URLs inconnues (/foobar) est le
 * proxy (matcher négatif → rewrite next-intl /fr/foobar → 404 routing natif).
 */
export const dynamicParams = false;

/**
 * hreflang par défaut du périmètre bilingue — valable pour la LANDING
 * (`/` ↔ `/en`). Les pages qui définissent leurs propres `alternates`
 * (login/register/verify-email, cookies, legal-notice, pages (seo))
 * écrasent intégralement ce bloc (merge shallow de Metadata).
 */
export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const { locale } = await params;

  return {
    alternates: {
      canonical: locale === "en" ? "/en" : "/",
      languages: {
        fr: "/",
        en: "/en",
        "x-default": "/",
      },
    },
  };
}

/**
 * Layout IMBRIQUÉ léger du périmètre public localisé.
 * Le root layout (app/layout.tsx) conserve <html>/<body>, les providers et
 * lang={getLocale()} — request.ts résout la locale du segment via
 * requestLocale. Ici : validation de la locale, setRequestLocale et override
 * du NextIntlClientProvider racine avec les messages de CETTE locale.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
