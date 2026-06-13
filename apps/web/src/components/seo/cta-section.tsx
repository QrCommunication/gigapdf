/**
 * Bloc d'appel à l'action des pages SEO : double CTA (compte gratuit + éditeur)
 * et encart open source / auto-hébergement avec lien GitHub.
 * Dictionnaire fr/en interne ; liens internes via le Link i18n (préfixe /en
 * automatique selon la locale courante).
 */

import { ArrowRight, Github } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import type { SeoLocale } from "@/lib/seo";

const GITHUB_URL = "https://github.com/ronylicha/gigapdf";

const COPY: Record<
  SeoLocale,
  {
    freePlan: string;
    register: string;
    openEditor: string;
    ossTitle: string;
    ossBody: string;
    github: string;
  }
> = {
  fr: {
    freePlan:
      "Plan gratuit complet : toutes les fonctionnalités, 5 Go de stockage, 100 documents et 1 000 appels API par mois. Sans carte bancaire.",
    register: "Créer un compte gratuit",
    openEditor: "Ouvrir l'éditeur",
    ossTitle: "100 % open source, auto-hébergeable",
    ossBody:
      "Code publié sous licence AGPL : auditez-le, contribuez, ou installez GigaPDF sur vos propres serveurs pour garder vos documents chez vous.",
    github: "Voir sur GitHub",
  },
  en: {
    freePlan:
      "The free plan is complete: every feature, 5 GB of storage, 100 documents and 1,000 API calls per month. No credit card required.",
    register: "Create a free account",
    openEditor: "Open the editor",
    ossTitle: "100% open source, self-hostable",
    ossBody:
      "The code is published under the AGPL license: audit it, contribute, or install GigaPDF on your own servers to keep your documents at home.",
    github: "View on GitHub",
  },
};

interface CtaSectionProps {
  /** Phrase d'accroche contextuelle au-dessus des boutons. */
  title: string;
  locale: SeoLocale;
}

export function CtaSection({ title, locale }: CtaSectionProps) {
  const copy = COPY[locale];

  return (
    <section className="mt-12 space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          {copy.freePlan}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">
              {copy.register}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/register">{copy.openEditor}</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-foreground">{copy.ossTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.ossBody}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.github}
          </a>
        </Button>
      </div>
    </section>
  );
}
