/**
 * Layout des pages SEO programmatique BILINGUES (/tools, /solutions, /en/*).
 * Header et footer marketing UNIFIÉS avec la landing page (components/header.tsx
 * & components/footer.tsx) : mêmes composants, mêmes liens (dont le mégamenu
 * « Fonctionnalités »), pour un maillage interne cohérent sur tout le périmètre
 * public. Header/Footer lisent la locale courante via useLocale() (next-intl,
 * couvert par NextIntlClientProvider du root layout) — aucune prop locale.
 *
 * La validation de la locale (fr|en) est déjà faite par le layout [locale]
 * (hasLocale) ; la garde isSeoLocale() ne sert ici qu'au narrowing TypeScript
 * (string → SeoLocale) et de défense en profondeur.
 */

import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
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
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
