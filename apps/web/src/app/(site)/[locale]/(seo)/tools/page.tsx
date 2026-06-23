import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { CtaSection } from "@/components/seo/cta-section";
import { ToolIcon } from "@/components/seo/tool-icon";
import { Link } from "@/i18n/navigation";
import { SITE_URL } from "@/lib/seo/constants";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import {
  getSolutionsData,
  getToolsData,
  isSeoLocale,
  localizePath,
  type SeoLocale,
} from "@/lib/seo";

// SSG : le root layout (site)/[locale] fournit les params de locale
// (generateStaticParams [{fr},{en}]) et le (seo)/layout pose setRequestLocale.
// Le hub n'a pas de segment dynamique propre → il est pré-rendu pour chaque
// locale sans generateStaticParams local.

interface ToolsHubPageProps {
  params: Promise<{ locale: string }>;
}

const COPY: Record<
  SeoLocale,
  {
    metaTitle: string;
    metaDescription: string;
    ogTitle: string;
    ogDescription: string;
    itemListName: string;
    listAria: string;
    h1: string;
    intro: string;
    solutionsTitle: string;
    solutionsText: string;
    ctaTitle: string;
  }
> = {
  fr: {
    metaTitle: "Outils PDF en ligne gratuits : éditer, signer, convertir",
    metaDescription:
      "36 outils PDF gratuits et open source : édition, fusion, signature numérique, OCR, compression, conversion Office et plus. Sans filigrane, auto-hébergeable.",
    ogTitle: "Outils PDF en ligne gratuits | GigaPDF",
    ogDescription:
      "Tous les outils PDF dont vous avez besoin, gratuits et open source : édition, signature, OCR, conversion, protection.",
    itemListName: "Outils PDF GigaPDF",
    listAria: "Liste des outils PDF",
    h1: "Outils PDF en ligne : tout faire sur vos documents, gratuitement",
    intro:
      "GigaPDF réunit en une seule plateforme les trente-six opérations qui composent la vie réelle d'un document PDF : éditer le texte et les tableaux avec les polices d'origine, fusionner et diviser des dossiers, signer numériquement avec votre certificat, reconnaître le texte des scans, protéger par chiffrement AES-256, convertir depuis et vers Word, Excel, PowerPoint, OpenDocument, Markdown, RTF, HTML, EPUB et images. Chaque outil est complet dans le plan gratuit — pas de version bridée, pas de filigrane publicitaire — et le code, open source sous licence PolyForm Noncommercial, peut tourner sur vos propres serveurs.",
    solutionsTitle: "Des outils pensés pour votre métier",
    solutionsText:
      "Au-delà des opérations unitaires, GigaPDF s'organise en workflows métiers : caviardage à valeur probante pour les avocats, OCR de pièces comptables pour les cabinets, signature de contrats pour les RH, dossiers de subvention pour les associations. Découvrez comment les outils s'assemblent pour votre activité.",
    ctaTitle: "Commencez à travailler vos PDF dès maintenant",
  },
  en: {
    metaTitle: "Free Online PDF Tools: Edit, Sign, Convert",
    metaDescription:
      "36 free, open-source PDF tools: editing, merging, digital signing, OCR, compression, Office conversion and more. No watermark, self-hostable.",
    ogTitle: "Free Online PDF Tools | GigaPDF",
    ogDescription:
      "Every PDF tool you need, free and open source: editing, signing, OCR, conversion, protection.",
    itemListName: "GigaPDF PDF Tools",
    listAria: "List of PDF tools",
    h1: "Online PDF tools: do everything with your documents, for free",
    intro:
      "GigaPDF brings together, on a single platform, the thirty-six operations that make up the real life of a PDF document: editing text and tables with the original fonts, merging and splitting files, signing digitally with your certificate, recognizing text in scans, protecting with AES-256 encryption, converting to and from Word, Excel, PowerPoint, OpenDocument, Markdown, RTF, HTML, EPUB and images. Every tool is complete in the free plan — no crippled version, no advertising watermark — and the code, open source under the PolyForm Noncommercial license, can run on your own servers.",
    solutionsTitle: "Tools designed around your profession",
    solutionsText:
      "Beyond individual operations, GigaPDF is organized into business workflows: evidence-grade redaction for lawyers, OCR of accounting documents for firms, contract signing for HR teams, grant application files for nonprofits. Discover how the tools fit together for your line of work.",
    ctaTitle: "Start working on your PDFs right now",
  },
};

export async function generateMetadata({ params }: ToolsHubPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isSeoLocale(locale)) notFound();
  const copy = COPY[locale];

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: publicPageAlternates("/tools", locale),
    openGraph: {
      type: "website",
      url: `${SITE_URL}${localizePath("/tools", locale)}`,
      title: copy.ogTitle,
      description: copy.ogDescription,
    },
  };
}

function buildItemListJsonLd(locale: SeoLocale): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: COPY[locale].itemListName,
    inLanguage: locale,
    itemListElement: getToolsData(locale).map((tool, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: tool.name,
      url: `${SITE_URL}${localizePath(`/tools/${tool.slug}`, locale)}`,
    })),
  };
}

export default async function ToolsHubPage({ params }: ToolsHubPageProps) {
  const { locale } = await params;
  if (!isSeoLocale(locale)) notFound();

  const copy = COPY[locale];
  const tools = getToolsData(locale);
  const solutions = getSolutionsData(locale);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <JsonLd data={buildItemListJsonLd(locale)} />

      <header className="max-w-[68ch]">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {copy.h1}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {copy.intro}
        </p>
      </header>

      <section className="mt-10" aria-label={copy.listAria}>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
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
          {copy.solutionsTitle}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {copy.solutionsText}
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {solutions.map((solution) => (
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

      <CtaSection title={copy.ctaTitle} locale={locale} />
    </div>
  );
}
