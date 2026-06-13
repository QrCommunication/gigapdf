"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { defaultLocale } from "@/i18n/config";
import { Logo } from "@/components/logo";
import { ExternalLink, Github } from "lucide-react";

const GITHUB_URL = "https://github.com/QrCommunication/gigapdf";

/**
 * Pied de page marketing — 4 colonnes façon achevé d'imprimer :
 * marque + Produit + Open source + Légal, baseline mono en colophon.
 */
export function Footer() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();
  // Logo (next/link interne, partagé avec le dashboard) : préfixer "/" à la main.
  const homeHref = locale === defaultLocale ? "/" : `/${locale}`;

  // frOnly : /tools et /solutions n'existent qu'en fr (404 sous /en/*) →
  // next/link brut, JAMAIS de préfixe de locale sur ces cibles.
  const productLinks = [
    { key: "features", href: "/tools", frOnly: true },
    { key: "solutions", href: "/solutions", frOnly: true },
    { key: "pricing", href: "/#pricing", frOnly: false },
    { key: "changelog", href: "/changelog", frOnly: false },
    { key: "docs", href: "/docs", frOnly: false },
  ] as const;

  const legalLinks = [
    { key: "legalNotice", href: "/legal-notice" },
    { key: "privacy", href: "/privacy" },
    { key: "terms", href: "/terms" },
    { key: "cookies", href: "/cookies" },
  ] as const;

  return (
    <footer className="border-t border-border bg-muted/30 py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Marque */}
          <div>
            <Logo href={homeHref} size="sm" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("tagline")}
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="mt-6 inline-flex text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>

          {/* Produit */}
          <nav aria-label={t("product.title")}>
            <h4 className="lp-label mb-4">{t("product.title")}</h4>
            <ul className="space-y-3 text-sm">
              {productLinks.map(({ key, href, frOnly }) => {
                const LinkComponent = frOnly ? NextLink : Link;
                return (
                  <li key={key}>
                    <LinkComponent
                      href={href}
                      className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    >
                      {t(`product.${key}`)}
                    </LinkComponent>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Open source */}
          <nav aria-label={t("openSource.title")}>
            <h4 className="lp-label mb-4">{t("openSource.title")}</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  {t("openSource.github")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  {t("openSource.license")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <Link
                  href="/docs"
                  className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  {t("openSource.selfHosting")}
                </Link>
              </li>
            </ul>
          </nav>

          {/* Légal */}
          <nav aria-label={t("legal.title")}>
            <h4 className="lp-label mb-4">{t("legal.title")}</h4>
            <ul className="space-y-3 text-sm">
              {legalLinks.map(({ key, href }) => (
                <li key={key}>
                  <Link
                    href={href}
                    className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  >
                    {t(`legal.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Colophon */}
        <div className="mx-auto mt-16 max-w-6xl border-t border-border pt-8">
          <p className="text-center font-mono text-xs text-muted-foreground">
            GigaPDF © {new Date().getFullYear()}
            <span aria-hidden="true" className="mx-3 text-muted-foreground/50">
              —
            </span>
            {t("baseline")}
          </p>
        </div>
      </div>
    </footer>
  );
}
