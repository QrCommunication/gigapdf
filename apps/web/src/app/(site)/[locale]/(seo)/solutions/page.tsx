import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

interface SolutionsHubPageProps {
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
    toolsTitle: string;
    toolsText: string;
    ctaTitle: string;
  }
> = {
  fr: {
    metaTitle: "Solutions PDF par métier : avocats, comptables, RH…",
    metaDescription:
      "GigaPDF appliqué à votre métier : caviardage pour avocats, OCR comptable, contrats RH, baux immobiliers, santé, éducation. Gratuit et open source.",
    ogTitle: "Solutions PDF par métier | GigaPDF",
    ogDescription:
      "Des workflows PDF concrets pour 10 métiers : juridique, comptabilité, RH, immobilier, santé, formation et plus.",
    itemListName: "Solutions métiers GigaPDF",
    listAria: "Liste des solutions métiers",
    h1: "GigaPDF appliqué à votre métier",
    intro:
      "Un avocat ne demande pas la même chose à un PDF qu'un expert-comptable ou qu'un architecte : le premier exige un caviardage qui supprime réellement le texte, le deuxième veut retrouver une facture scannée par son montant, le troisième annote des plans de plusieurs dizaines de mégaoctets. Ces pages décrivent, métier par métier, les workflows concrets que GigaPDF outille — avec les mêmes fonctions pour tous, car le plan gratuit n'ampute rien : signature numérique PKCS#7, OCR, chiffrement AES-256, GED complète et collaboration en temps réel, le tout open source et auto-hébergeable.",
    toolsTitle: "Les outils derrière les workflows",
    toolsText:
      "Chaque solution métier s'appuie sur les mêmes briques : les vingt-neuf outils PDF de la plateforme, utilisables individuellement et tous documentés.",
    ctaTitle: "Adoptez GigaPDF pour votre activité",
  },
  en: {
    metaTitle: "PDF Solutions by Profession: Lawyers, Accountants, HR",
    metaDescription:
      "GigaPDF applied to your profession: redaction for lawyers, accounting OCR, HR contracts, real-estate leases, healthcare, education. Free and open source.",
    ogTitle: "PDF Solutions by Profession | GigaPDF",
    ogDescription:
      "Concrete PDF workflows for 10 professions: legal, accounting, HR, real estate, healthcare, training and more.",
    itemListName: "GigaPDF Business Solutions",
    listAria: "List of business solutions",
    h1: "GigaPDF applied to your profession",
    intro:
      "A lawyer does not ask the same things of a PDF as an accountant or an architect: the first demands redaction that genuinely removes the text, the second wants to find a scanned invoice by its amount, the third annotates plans weighing tens of megabytes. These pages describe, profession by profession, the concrete workflows GigaPDF equips — with the same features for everyone, because the free plan cuts nothing out: PKCS#7 digital signing, OCR, AES-256 encryption, full document management and real-time collaboration, all open source and self-hostable.",
    toolsTitle: "The tools behind the workflows",
    toolsText:
      "Every business solution relies on the same building blocks: the platform's twenty-nine PDF tools, usable individually and all documented.",
    ctaTitle: "Adopt GigaPDF for your business",
  },
};

export async function generateMetadata({
  params,
}: SolutionsHubPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isSeoLocale(locale)) notFound();
  const copy = COPY[locale];

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: publicPageAlternates("/solutions", locale),
    openGraph: {
      type: "website",
      url: `${SITE_URL}${localizePath("/solutions", locale)}`,
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
    itemListElement: getSolutionsData(locale).map((solution, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: solution.name,
      url: `${SITE_URL}${localizePath(`/solutions/${solution.slug}`, locale)}`,
    })),
  };
}

export default async function SolutionsHubPage({ params }: SolutionsHubPageProps) {
  const { locale } = await params;
  if (!isSeoLocale(locale)) notFound();

  const copy = COPY[locale];
  const solutions = getSolutionsData(locale);
  const tools = getToolsData(locale);

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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {solutions.map((solution) => (
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
          {copy.toolsTitle}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {copy.toolsText}
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {tools.map((tool) => (
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

      <CtaSection title={copy.ctaTitle} locale={locale} />
    </div>
  );
}
