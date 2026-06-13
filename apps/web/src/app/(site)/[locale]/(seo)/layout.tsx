/**
 * Layout des pages SEO programmatique BILINGUES (/tools, /solutions, /en/*).
 * Header et footer marketing AUTONOMES (components/seo/) : aucun couplage
 * avec la landing page ni avec les messages next-intl — dictionnaires fr/en
 * internes aux composants, données par locale via lib/seo (resolver).
 *
 * La validation de la locale (fr|en) est déjà faite par le layout [locale]
 * (hasLocale) ; la garde isSeoLocale() ne sert ici qu'au narrowing TypeScript
 * (string → SeoLocale) et de défense en profondeur.
 */

import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SeoFooter } from "@/components/seo/seo-footer";
import { SeoHeader } from "@/components/seo/seo-header";
import { isSeoLocale } from "@/lib/seo";

interface SeoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function SeoLayout({ children, params }: SeoLayoutProps) {
  const { locale } = await params;

  if (!isSeoLocale(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SeoHeader locale={locale} />
      <main className="flex-1">{children}</main>
      <SeoFooter locale={locale} />
    </div>
  );
}
