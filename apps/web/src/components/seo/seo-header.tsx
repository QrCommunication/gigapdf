/**
 * Header marketing autonome pour les pages SEO (/tools, /solutions).
 * Volontairement découplé du Header de la landing (refonte en parallèle) :
 * server component pur, texte en dur (FR), zéro état client.
 */

import Image from "next/image";
import Link from "next/link";
import { Button } from "@giga-pdf/ui";

export function SeoHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center" aria-label="GigaPDF — Accueil">
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

        <nav aria-label="Navigation principale" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/tools"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            Outils PDF
          </Link>
          <Link
            href="/solutions"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            Solutions
          </Link>
          <Link
            href="/#pricing"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
          >
            Tarifs
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Connexion</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Créer un compte</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
