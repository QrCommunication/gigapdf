import type { Metadata } from "next";
import Link from "next/link";
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
import { SITE_URL } from "@/lib/seo/constants";
import { getSolutionBySlug, type SolutionData } from "@/lib/seo/solutions-data";
import { getToolBySlug, type ToolData } from "@/lib/seo/tools-data";
import { defaultLocale } from "@/i18n/config";

interface SolutionPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

// Pas de generateStaticParams : le root layout (résolution cookie) rend tout
// l'arbre dynamique — une page classée SSG plante en DYNAMIC_SERVER_USAGE au
// runtime. /en/solutions/* : 404 via le proxy (rewrite) + gardes notFound().

export async function generateMetadata({ params }: SolutionPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  // Garde fr-only AVANT le premier flush du stream : notFound() ici produit un
  // vrai 404 HTTP (celle du layout (seo) arrive après l'envoi du status 200).
  if (locale !== defaultLocale) notFound();
  const solution = getSolutionBySlug(slug);
  if (!solution) return {};

  return {
    title: { absolute: solution.metaTitle },
    description: solution.metaDescription,
    alternates: { canonical: `/solutions/${solution.slug}` },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/solutions/${solution.slug}`,
      title: solution.metaTitle,
      description: solution.metaDescription,
    },
  };
}

function buildSolutionJsonLd(solution: SolutionData): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}/solutions/${solution.slug}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `GigaPDF pour ${solution.name}`,
      url: pageUrl,
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
  if (locale !== defaultLocale) notFound();
  const solution = getSolutionBySlug(slug);
  if (!solution) notFound();

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: "Accueil", href: "/" },
    { label: "Solutions métiers", href: "/solutions" },
    { label: solution.name, href: `/solutions/${solution.slug}` },
  ];

  const relatedTools = solution.relatedTools
    .map((relatedSlug) => getToolBySlug(relatedSlug))
    .filter((tool): tool is ToolData => tool !== undefined);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {buildSolutionJsonLd(solution).map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <JsonLd data={buildBreadcrumbJsonLd(SITE_URL, breadcrumbItems)} />

      <SeoBreadcrumb items={breadcrumbItems} />

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
            Workflows concrets
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
            Capacités clés pour ce métier
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
            Questions fréquentes
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
          Les outils utilisés dans ces workflows
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
          Voir aussi{" "}
          <Link
            href="/tools"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            les 20 outils PDF de GigaPDF
          </Link>{" "}
          et{" "}
          <Link
            href="/solutions"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            les autres solutions métiers
          </Link>
          .
        </p>
      </section>

      <CtaSection title={`GigaPDF pour ${solution.name.toLowerCase()} : démarrez gratuitement`} />
    </div>
  );
}
