import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MarketingError } from "@/components/seo/error-marketing";
import { isSeoLocale } from "@/lib/seo";

// ---------------------------------------------------------------------------
// 403 MARKETING — « contenu réservé » du périmètre public ((site)/[locale]).
//
// Page réelle (pas une convention not-found) : on peut y rediriger un visiteur
// non authentifié qui tente d'atteindre un contenu public protégé. Orientée
// conversion (rappel des fonctionnalités + CTA d'inscription gratuite).
//
// SSG comme tout le périmètre public : locale issue de params (setRequestLocale),
// AUCUN cookies()/getLocale(). generateStaticParams pré-rend /403 et /en/403.
// Page utilitaire → noindex (pas un contenu SEO indexable).
// ---------------------------------------------------------------------------

interface ForbiddenPageProps {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return [{ locale: "fr" }, { locale: "en" }];
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: ForbiddenPageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("errors.marketing.forbidden");

  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: true },
  };
}

export default async function ForbiddenPage({ params }: ForbiddenPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const seoLocale = isSeoLocale(locale) ? locale : "fr";

  return <MarketingError locale={seoLocale} variant="forbidden" />;
}
