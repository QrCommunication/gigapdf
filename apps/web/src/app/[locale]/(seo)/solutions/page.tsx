import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { CtaSection } from "@/components/seo/cta-section";
import { ToolIcon } from "@/components/seo/tool-icon";
import { SITE_URL } from "@/lib/seo/constants";
import { SOLUTIONS } from "@/lib/seo/solutions-data";
import { TOOLS } from "@/lib/seo/tools-data";
import { defaultLocale } from "@/i18n/config";

// Pas de generateStaticParams ici : le root layout (getLocale/getMessages,
// résolution cookie pour le dashboard) rend tout l'arbre dynamique — une page
// classée SSG plante en DYNAMIC_SERVER_USAGE au runtime. Le 404 de
// /en/solutions est garanti par le proxy (rewrite) + les gardes notFound().

interface SolutionsHubPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: SolutionsHubPageProps): Promise<Metadata> {
  const { locale } = await params;
  // Garde fr-only AVANT le premier flush du stream : notFound() ici produit un
  // vrai 404 HTTP (celle du layout (seo) arrive après l'envoi du status 200).
  if (locale !== defaultLocale) notFound();

  return {
    title: "Solutions PDF par métier : avocats, comptables, RH…",
    description:
      "GigaPDF appliqué à votre métier : caviardage pour avocats, OCR comptable, contrats RH, baux immobiliers, santé, éducation. Gratuit et open source.",
    alternates: { canonical: "/solutions" },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/solutions`,
      title: "Solutions PDF par métier | GigaPDF",
      description:
        "Des workflows PDF concrets pour 10 métiers : juridique, comptabilité, RH, immobilier, santé, formation et plus.",
    },
  };
}

const itemListJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Solutions métiers GigaPDF",
  itemListElement: SOLUTIONS.map((solution, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: solution.name,
    url: `${SITE_URL}/solutions/${solution.slug}`,
  })),
};

export default async function SolutionsHubPage({ params }: SolutionsHubPageProps) {
  const { locale } = await params;
  if (locale !== defaultLocale) notFound();

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <JsonLd data={itemListJsonLd} />

      <header className="max-w-[68ch]">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          GigaPDF appliqué à votre métier
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Un avocat ne demande pas la même chose à un PDF qu&apos;un
          expert-comptable ou qu&apos;un architecte : le premier exige un
          caviardage qui supprime réellement le texte, le deuxième veut
          retrouver une facture scannée par son montant, le troisième annote
          des plans de plusieurs dizaines de mégaoctets. Ces pages décrivent,
          métier par métier, les workflows concrets que GigaPDF outille — avec
          les mêmes fonctions pour tous, car le plan gratuit n&apos;ampute
          rien : signature numérique PKCS#7, OCR, chiffrement AES-256, GED
          complète et collaboration en temps réel, le tout open source et
          auto-hébergeable.
        </p>
      </header>

      <section className="mt-10" aria-label="Liste des solutions métiers">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SOLUTIONS.map((solution) => (
            <li key={solution.slug}>
              <Link
                href={`/solutions/${solution.slug}`}
                className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-card/80"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <ToolIcon name={solution.icon} className="h-5 w-5" />
                  </span>
                  <span className="font-semibold text-foreground group-hover:text-primary">
                    {solution.name}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {solution.metaDescription}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 max-w-[68ch]">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Les outils derrière les workflows
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Chaque solution métier s&apos;appuie sur les mêmes briques : les
          vingt outils PDF de la plateforme, utilisables individuellement et
          tous documentés.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {TOOLS.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`/tools/${tool.slug}`}
                className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {tool.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <CtaSection title="Adoptez GigaPDF pour votre activité" />
    </div>
  );
}
