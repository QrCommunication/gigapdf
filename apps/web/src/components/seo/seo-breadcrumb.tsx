/**
 * Fil d'Ariane visible des pages SEO bilingues.
 * Les items portent des hrefs NON préfixés (/tools/<slug-de-la-locale>) :
 * le Link i18n ajoute /en automatiquement, et le JSON-LD BreadcrumbList
 * localise les URLs via localizePath (même source de vérité).
 */

import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { localizePath, type SeoLocale } from "@/lib/seo";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

const NAV_ARIA: Record<SeoLocale, string> = {
  fr: "Fil d'Ariane",
  en: "Breadcrumb",
};

interface SeoBreadcrumbProps {
  items: BreadcrumbItem[];
  locale: SeoLocale;
}

export function SeoBreadcrumb({ items, locale }: SeoBreadcrumbProps) {
  return (
    <nav aria-label={NAV_ARIA[locale]} className="mb-6">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
              {isLast ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Construit le JSON-LD BreadcrumbList correspondant aux items affichés,
 * avec les URLs localisées (préfixe /en pour la locale anglaise).
 */
export function buildBreadcrumbJsonLd(
  baseUrl: string,
  items: BreadcrumbItem[],
  locale: SeoLocale,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `${baseUrl}${localizePath(item.href, locale)}`,
    })),
  };
}
