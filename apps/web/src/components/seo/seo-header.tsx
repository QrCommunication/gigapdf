/**
 * Header marketing autonome pour les pages SEO (/tools, /solutions, /en/*).
 * Volontairement découplé du Header de la landing (refonte en parallèle) :
 * server component pur, dictionnaire fr/en interne, zéro état client.
 * Liens internes via le Link i18n (@/i18n/navigation) : préfixe /en automatique
 * selon la locale courante.
 */

import Image from "next/image";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import type { SeoLocale } from "@/lib/seo";

const COPY: Record<
  SeoLocale,
  {
    homeAria: string;
    navAria: string;
    tools: string;
    solutions: string;
    pricing: string;
    login: string;
    register: string;
  }
> = {
  fr: {
    homeAria: "GigaPDF — Accueil",
    navAria: "Navigation principale",
    tools: "Outils PDF",
    solutions: "Solutions",
    pricing: "Tarifs",
    login: "Connexion",
    register: "Créer un compte",
  },
  en: {
    homeAria: "GigaPDF — Home",
    navAria: "Main navigation",
    tools: "PDF Tools",
    solutions: "Solutions",
    pricing: "Pricing",
    login: "Log in",
    register: "Sign up",
  },
};

interface SeoHeaderProps {
  locale: SeoLocale;
}

export function SeoHeader({ locale }: SeoHeaderProps) {
  const copy = COPY[locale];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center" aria-label={copy.homeAria}>
          {/* Variantes light/dark sans JavaScript : visibilité pilotée par la classe .dark */}
          <Image
            src="/logo-horizontal-light.svg"
            alt="GigaPDF"
            width={140}
            height={40}
            className="h-8 w-auto dark:hidden"
            priority
          />
          <Image
            src="/logo-horizontal-dark.svg"
            alt=""
            width={140}
            height={40}
            className="hidden h-8 w-auto dark:block"
            priority
          />
        </Link>

        <nav aria-label={copy.navAria} className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/tools"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            {copy.tools}
          </Link>
          <Link
            href="/solutions"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            {copy.solutions}
          </Link>
          <Link
            href="/#pricing"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
          >
            {copy.pricing}
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{copy.login}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">{copy.register}</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
