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
import { getAllToolSlugs, getToolBySlug, type ToolData } from "@/lib/seo/tools-data";
import { getSolutionBySlug } from "@/lib/seo/solutions-data";

interface ToolPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllToolSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: ToolPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) return {};

  return {
    title: { absolute: tool.metaTitle },
    description: tool.metaDescription,
    alternates: { canonical: `/tools/${tool.slug}` },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/tools/${tool.slug}`,
      title: tool.metaTitle,
      description: tool.metaDescription,
    },
  };
}

function buildToolJsonLd(tool: ToolData): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}/tools/${tool.slug}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `GigaPDF — ${tool.name}`,
      url: pageUrl,
      description: tool.metaDescription,
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
      "@type": "HowTo",
      name: tool.howTo.title,
      step: tool.howTo.steps.map((step, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        name: `Étape ${index + 1}`,
        text: step,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: tool.faq.map((item) => ({
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

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: "Accueil", href: "/" },
    { label: "Outils PDF", href: "/tools" },
    { label: tool.name, href: `/tools/${tool.slug}` },
  ];

  const relatedTools = tool.relatedTools
    .map((relatedSlug) => getToolBySlug(relatedSlug))
    .filter((related): related is ToolData => related !== undefined);
  const relatedSolutions = tool.relatedSolutions
    .map((relatedSlug) => getSolutionBySlug(relatedSlug))
    .filter((solution) => solution !== undefined);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {buildToolJsonLd(tool).map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <JsonLd data={buildBreadcrumbJsonLd(SITE_URL, breadcrumbItems)} />

      <SeoBreadcrumb items={breadcrumbItems} />

      <article className="max-w-[68ch]">
        <header>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ToolIcon name={tool.icon} className="h-6 w-6" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{tool.h1}</h1>
          </div>
        </header>

        <div className="mt-6 space-y-4">
          {tool.intro.map((paragraph, index) => (
            <p key={index} className="text-base leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {tool.howTo.title}
          </h2>
          <ol className="mt-4 space-y-3">
            {tool.howTo.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="text-base leading-relaxed text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ce que l&apos;outil sait faire
          </h2>
          <ul className="mt-4 space-y-2">
            {tool.capabilities.map((capability, index) => (
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
            Cas d&apos;usage courants
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            {tool.useCases.map((useCase, index) => (
              <li key={index} className="text-base leading-relaxed text-muted-foreground">
                {useCase}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Questions fréquentes
          </h2>
          <div className="mt-4 space-y-6">
            {tool.faq.map((item, index) => (
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
        <h2 className="text-xl font-bold tracking-tight text-foreground">Outils associés</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {relatedTools.map((related) => (
            <li key={related.slug}>
              <Link
                href={`/tools/${related.slug}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ToolIcon name={related.icon} className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-primary">
                  {related.name}
                </span>
                <ArrowRight
                  className="ml-auto h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>

        {relatedSolutions.length > 0 && (
          <>
            <h2 className="mt-8 text-xl font-bold tracking-tight text-foreground">
              Pour votre métier
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {relatedSolutions.map((solution) => (
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
          </>
        )}
      </section>

      <CtaSection title={`${tool.name} : essayez gratuitement`} />
    </div>
  );
}
