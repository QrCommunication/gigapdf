/**
 * Layout des pages SEO programmatique (/tools, /solutions).
 * Header et footer marketing AUTONOMES (components/seo/) : aucun couplage
 * avec la landing page ni avec les messages next-intl — contenu en dur (FR).
 *
 * Contenu rédigé en FRANÇAIS uniquement : toute locale autre que `fr`
 * répond 404 (/en/tools, /en/solutions n'existent pas — pas de hreflang en,
 * pas d'entrée /en dans le sitemap). Les generateStaticParams des pages du
 * groupe ne déclarent que `fr` ; cette garde runtime couvre les requêtes
 * dynamiques restantes (dynamicParams).
 */

import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { defaultLocale } from "@/i18n/config";
import { SeoFooter } from "@/components/seo/seo-footer";
import { SeoHeader } from "@/components/seo/seo-header";

interface SeoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function SeoLayout({ children, params }: SeoLayoutProps) {
  const { locale } = await params;

  if (locale !== defaultLocale) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SeoHeader />
      <main className="flex-1">{children}</main>
      <SeoFooter />
    </div>
  );
}
