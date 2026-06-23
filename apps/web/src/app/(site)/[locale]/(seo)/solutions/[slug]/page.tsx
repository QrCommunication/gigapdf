import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { CtaSection } from "@/components/seo/cta-section";
import {
  SeoBreadcrumb,
  buildBreadcrumbJsonLd,
  type BreadcrumbItem,
} from "@/components/seo/seo-breadcrumb";
import { ToolIcon } from "@/components/seo/tool-icon";
import { Link } from "@/i18n/navigation";
import { SITE_URL } from "@/lib/seo/constants";
import { routing } from "@/i18n/routing";
import {
  buildSlugAlternates,
  getSolutionAlternatePaths,
  getSolutionBySlugForLocale,
  getSolutionsData,
  getToolBySlugForLocale,
  isSeoLocale,
  localizePath,
  type SeoLocale,
  type SolutionData,
  type ToolData,
} from "@/lib/seo";

interface SolutionPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

// SSG : un (locale, slug) par solution DANS sa locale. Combiné à
// dynamicParams=false, un slug inconnu OU croisé (slug fr sous /en et
// inversement) n'est jamais matché → 404 NATIF statique, sans dépendre du proxy
// ni d'un soft-404 notFound().
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    isSeoLocale(locale)
      ? getSolutionsData(locale).map((solution) => ({ locale, slug: solution.slug }))
      : [],
  );
}

export const dynamicParams = false;

const STRINGS: Record<
  SeoLocale,
  {
    home: string;
    solutionsHub: string;
    workflows: string;
    capabilities: string;
    faq: string;
    relatedTools: string;
    seeAlso: string;
    allToolsLink: string;
    and: string;
    otherSolutionsLink: string;
    cta: (solutionName: string) => string;
  }
> = {
  fr: {
    home: "Accueil",
    solutionsHub: "Solutions métiers",
    workflows: "Workflows concrets",
    capabilities: "Capacités clés pour ce métier",
    faq: "Questions fréquentes",
    relatedTools: "Les outils utilisés dans ces workflows",
    seeAlso: "Voir aussi",
    allToolsLink: "les 36 outils PDF de GigaPDF",
    and: "et",
    otherSolutionsLink: "les autres solutions métiers",
    cta: (solutionName) =>
      `GigaPDF pour ${solutionName.toLowerCase()} : démarrez gratuitement`,
  },
  en: {
    home: "Home",
    solutionsHub: "Business solutions",
    workflows: "Concrete workflows",
    capabilities: "Key capabilities for this profession",
    faq: "Frequently asked questions",
    relatedTools: "The tools used in these workflows",
    seeAlso: "See also",
    allToolsLink: "the 36 GigaPDF PDF tools",
    and: "and",
    otherSolutionsLink: "the other business solutions",
    cta: (solutionName) =>
      `GigaPDF for ${solutionName.toLowerCase()}: get started for free`,
  },
};

export async function generateMetadata({ params }: SolutionPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSeoLocale(locale)) notFound();
  const solution = getSolutionBySlugForLocale(locale, slug);
  // Slug inconnu dans CETTE locale → vrai 404 HTTP (avant le stream).
  if (!solution) notFound();

  const paths = getSolutionAlternatePaths(slug);

  return {
    title: { absolute: solution.metaTitle },
    description: solution.metaDescription,
    alternates: paths ? buildSlugAlternates(paths, locale) : undefined,
    openGraph: {
      type: "website",
      url: `${SITE_URL}${localizePath(`/solutions/${solution.slug}`, locale)}`,
      title: solution.metaTitle,
      description: solution.metaDescription,
    },
  };
}

function buildSolutionJsonLd(
  solution: SolutionData,
  locale: SeoLocale,
): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}${localizePath(`/solutions/${solution.slug}`, locale)}`;
  const namePrefix = locale === "en" ? "GigaPDF for" : "GigaPDF pour";

  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `${namePrefix} ${solution.name}`,
      url: pageUrl,
      inLanguage: locale,
      description: solution.metaDescription,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "EUR",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: locale,
      mainEntity: solution.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ];
}

export default async function SolutionPage({ params }: SolutionPageProps) {
  const { locale, slug } = await params;
  if (!isSeoLocale(locale)) notFound();
  const solution = getSolutionBySlugForLocale(locale, slug);
  if (!solution) notFound();

  const strings = STRINGS[locale];

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: strings.home, href: "/" },
    { label: strings.solutionsHub, href: "/solutions" },
    { label: solution.name, href: `/solutions/${solution.slug}` },
  ];

  const relatedTools = solution.relatedTools
    .map((relatedSlug) => getToolBySlugForLocale(locale, relatedSlug))
    .filter((tool): tool is ToolData => tool !== undefined);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {buildSolutionJsonLd(solution, locale).map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <JsonLd data={buildBreadcrumbJsonLd(SITE_URL, breadcrumbItems, locale)} />

      <SeoBreadcrumb items={breadcrumbItems} locale={locale} />

      <article className="max-w-[68ch]">
        <header>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ToolIcon name={solution.icon} className="h-6 w-6" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {solution.h1}
            </h1>
          </div>
        </header>

        <div className="mt-6 space-y-4">
          {solution.intro.map((paragraph, index) => (
            <p key={index} className="text-base leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.workflows}
          </h2>
          <div className="mt-4 space-y-6">
            {solution.workflows.map((workflow, index) => (
              <div key={index} className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-lg font-semibold text-foreground">{workflow.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  {workflow.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.capabilities}
          </h2>
          <ul className="mt-4 space-y-2">
            {solution.capabilities.map((capability, index) => (
              <li key={index} className="flex gap-2.5">
                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-base leading-relaxed text-muted-foreground">
                  {capability}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.faq}
          </h2>
          <div className="mt-4 space-y-6">
            {solution.faq.map((item, index) => (
              <div key={index}>
                <h3 className="text-lg font-semibold text-foreground">{item.question}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>
        </section>
      </article>

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {strings.relatedTools}
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {relatedTools.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`/tools/${tool.slug}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ToolIcon name={tool.icon} className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-primary">
                  {tool.name}
                </span>
                <ArrowRight
                  className="ml-auto h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-muted-foreground">
          {strings.seeAlso}{" "}
          <Link
            href="/tools"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {strings.allToolsLink}
          </Link>{" "}
          {strings.and}{" "}
          <Link
            href="/solutions"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {strings.otherSolutionsLink}
          </Link>
          .
        </p>
      </section>

      <CtaSection title={strings.cta(solution.name)} locale={locale} />
    </div>
  );
}
