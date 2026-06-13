import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { CtaSection } from "@/components/seo/cta-section";
import { ToolIcon } from "@/components/seo/tool-icon";
import { SITE_URL } from "@/lib/seo/constants";
import { TOOLS } from "@/lib/seo/tools-data";
import { SOLUTIONS } from "@/lib/seo/solutions-data";

export const metadata: Metadata = {
  title: "Outils PDF en ligne gratuits : éditer, signer, convertir",
  description:
    "20 outils PDF gratuits et open source : édition, fusion, signature numérique, OCR, compression, conversion Office et plus. Sans filigrane, auto-hébergeable.",
  alternates: { canonical: "/tools" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/tools`,
    title: "Outils PDF en ligne gratuits | GigaPDF",
    description:
      "Tous les outils PDF dont vous avez besoin, gratuits et open source : édition, signature, OCR, conversion, protection.",
  },
};

const itemListJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Outils PDF GigaPDF",
  itemListElement: TOOLS.map((tool, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: tool.name,
    url: `${SITE_URL}/tools/${tool.slug}`,
  })),
};

export default function ToolsHubPage() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <JsonLd data={itemListJsonLd} />

      <header className="max-w-[68ch]">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Outils PDF en ligne : tout faire sur vos documents, gratuitement
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          GigaPDF réunit en une seule plateforme les vingt opérations qui
          composent la vie réelle d&apos;un document PDF : éditer le texte avec
          les polices d&apos;origine, fusionner et diviser des dossiers, signer
          numériquement avec votre certificat, reconnaître le texte des scans,
          protéger par chiffrement AES-256, convertir depuis et vers Word,
          Excel, PowerPoint et OpenDocument. Chaque outil est complet dans le
          plan gratuit — pas de version bridée, pas de filigrane publicitaire —
          et le code, open source sous licence AGPL, peut tourner sur vos
          propres serveurs.
        </p>
      </header>

      <section className="mt-10" aria-label="Liste des outils PDF">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`/tools/${tool.slug}`}
                className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-card/80"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <ToolIcon name={tool.icon} className="h-5 w-5" />
                  </span>
                  <span className="font-semibold text-foreground group-hover:text-primary">
                    {tool.name}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {tool.metaDescription}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 max-w-[68ch]">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Des outils pensés pour votre métier
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Au-delà des opérations unitaires, GigaPDF s&apos;organise en
          workflows métiers : caviardage à valeur probante pour les avocats,
          OCR de pièces comptables pour les cabinets, signature de contrats
          pour les RH, dossiers de subvention pour les associations. Découvrez
          comment les outils s&apos;assemblent pour votre activité.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {SOLUTIONS.map((solution) => (
            <li key={solution.slug}>
              <Link
                href={`/solutions/${solution.slug}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {solution.name}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <CtaSection title="Commencez à travailler vos PDF dès maintenant" />
    </div>
  );
}
