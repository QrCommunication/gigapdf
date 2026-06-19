/**
 * Pages d'erreur MARKETING (404 / 403) du périmètre public ((site)/[locale]).
 * Orientées conversion : héros, rappel des fonctionnalités GigaPDF, suggestions
 * d'outils / solutions issues des données SEO, et double CTA d'inscription.
 *
 * Server component pur (zéro état client) : il s'insère dans le root layout
 * (site)/[locale] qui fournit déjà le contexte NextIntl (locale via params).
 * Les libellés viennent du namespace `errors.marketing.*` (FR + EN) ; les
 * suggestions réutilisent getToolsData/getSolutionsData + ToolIcon + CtaSection.
 *
 * IMPORTANT — VRAI 404 (pas un soft-404) : ce composant est rendu UNIQUEMENT
 * par `(site)/[locale]/not-found.tsx` (déclenché par le 404 natif que produit
 * le root layout statique + dynamicParams=false, cf. proxy.ts), jamais via un
 * `notFound()` dans une page dynamique. Le statut HTTP 404 est donc préservé.
 */

import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  FileSearch,
  Lock,
  PenLine,
  Replace,
  ScanText,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import { CtaSection } from "@/components/seo/cta-section";
import { ToolIcon } from "@/components/seo/tool-icon";
import { getSolutionsData, getToolsData, type SeoLocale } from "@/lib/seo";

type MarketingErrorVariant = "notFound" | "forbidden";

interface MarketingErrorProps {
  locale: SeoLocale;
  variant: MarketingErrorVariant;
}

/** Fonctionnalités phares rappelées sur les pages d'erreur (clés i18n + icône). */
const FEATURES: { key: string; icon: LucideIcon }[] = [
  { key: "editor", icon: PenLine },
  { key: "convert", icon: Replace },
  { key: "ocr", icon: ScanText },
  { key: "search", icon: FileSearch },
  { key: "redaction", icon: ShieldOff },
  { key: "sign", icon: Lock },
];

/** Nombre d'outils / solutions mis en avant en suggestion. */
const FEATURED_TOOLS = 6;
const FEATURED_SOLUTIONS = 6;

export async function MarketingError({ locale, variant }: MarketingErrorProps) {
  const t = await getTranslations(`errors.marketing.${variant}`);
  const tFeatures = await getTranslations("errors.marketing.features");

  return (
    <main className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
      {/* Héros */}
      <section className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-muted-foreground">
          <span className="font-mono text-primary">{t("code")}</span>
          <span aria-hidden="true">·</span>
          {t("badge")}
        </span>
        <h1 className="mt-6 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t("description")}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={variant === "notFound" ? "/tools" : "/register"}>
              {t("primaryCta")}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={variant === "notFound" ? "/" : "/login"}>
              {t("secondaryCta")}
            </Link>
          </Button>
        </div>
      </section>

      {variant === "notFound" ? (
        <NotFoundSuggestions locale={locale} t={t} />
      ) : (
        <ForbiddenFeatures
          title={tFeatures("title")}
          subtitle={tFeatures("subtitle")}
          featureName={(key) => tFeatures(`${key}.name`)}
          featureDescription={(key) => tFeatures(`${key}.description`)}
        />
      )}

      <div className="mt-16">
        <CtaSection title={t("registerCta")} locale={locale} />
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* 404 — suggestions d'outils + solutions (réutilise les données SEO).         */
/* -------------------------------------------------------------------------- */

async function NotFoundSuggestions({
  locale,
  t,
}: {
  locale: SeoLocale;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const tools = getToolsData(locale).slice(0, FEATURED_TOOLS);
  const solutions = getSolutionsData(locale).slice(0, FEATURED_SOLUTIONS);

  return (
    <>
      <section className="mt-16" aria-label={t("toolsTitle")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {t("toolsTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("toolsSubtitle")}</p>
          </div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {t("viewAllTools")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                  {tool.metaDescription}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" aria-label={t("solutionsTitle")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {t("solutionsTitle")}
          </h2>
          <Link
            href="/solutions"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {t("viewAllSolutions")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2">
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
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 403 — grille de fonctionnalités (le contenu est privé → on vend la valeur). */
/* -------------------------------------------------------------------------- */

function ForbiddenFeatures({
  title,
  subtitle,
  featureName,
  featureDescription,
}: {
  title: string;
  subtitle: string;
  featureName: (key: string) => string;
  featureDescription: (key: string) => string;
}) {
  return (
    <section className="mt-16" aria-label={title}>
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <ul className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ key, icon: Icon }) => (
          <li
            key={key}
            className="flex h-full flex-col rounded-lg border border-border bg-card p-5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3 font-semibold text-foreground">{featureName(key)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {featureDescription(key)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { MarketingErrorVariant };
