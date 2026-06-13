/**
 * Bloc d'appel à l'action des pages SEO : double CTA (compte gratuit + éditeur)
 * et encart open source / auto-hébergement avec lien GitHub.
 */

import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { Button } from "@giga-pdf/ui";

const GITHUB_URL = "https://github.com/ronylicha/gigapdf";

interface CtaSectionProps {
  /** Phrase d'accroche contextuelle au-dessus des boutons. */
  title: string;
}

export function CtaSection({ title }: CtaSectionProps) {
  return (
    <section className="mt-12 space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Plan gratuit complet : toutes les fonctionnalités, 5 Go de stockage,
          100 documents et 1 000 appels API par mois. Sans carte bancaire.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">
              Créer un compte gratuit
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/register">Ouvrir l&apos;éditeur</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-foreground">
            100&nbsp;% open source, auto-hébergeable
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Code publié sous licence AGPL : auditez-le, contribuez, ou installez
            GigaPDF sur vos propres serveurs pour garder vos documents chez vous.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 h-4 w-4" aria-hidden="true" />
            Voir sur GitHub
          </a>
        </Button>
      </div>
    </section>
  );
}
