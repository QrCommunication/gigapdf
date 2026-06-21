"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Menu, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { defaultLocale } from "@/i18n/config";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { ToolIcon } from "@/components/seo/tool-icon";
import { getToolsData, isSeoLocale, type ToolData } from "@/lib/seo";
import type { ToolCategory } from "@/lib/seo/tools-data";
import { Button } from "@giga-pdf/ui";
import { GithubIcon as Github } from "@/components/icons/github-icon";

/**
 * Ordre d'affichage des familles d'outils dans le mégamenu. Stable et exhaustif
 * sur ToolCategory : tout outil tombe dans l'une de ces colonnes.
 */
const CATEGORY_ORDER: readonly ToolCategory[] = [
  "organize",
  "convert",
  "edit",
  "secure",
  "ocr",
];

/** Regroupe les outils par catégorie en préservant l'ordre de CATEGORY_ORDER. */
function groupToolsByCategory(tools: ToolData[]): Array<[ToolCategory, ToolData[]]> {
  return CATEGORY_ORDER.map(
    (category) =>
      [category, tools.filter((tool) => tool.category === category)] as [
        ToolCategory,
        ToolData[],
      ],
  ).filter(([, items]) => items.length > 0);
}

export function Header() {
  const t = useTranslations();
  const locale = useLocale();
  // Logo (next/link interne, partagé avec le dashboard) : préfixer la cible
  // publique "/" manuellement pour conserver la locale courante (/en).
  const homeHref = locale === defaultLocale ? "/" : `/${locale}`;

  // Outils groupés pour le mégamenu, dans la locale courante (slugs localisés).
  // isSeoLocale narrowing : le périmètre public est toujours fr|en, mais on
  // retombe proprement sur fr si jamais la locale n'est pas SEO.
  const tools = getToolsData(isSeoLocale(locale) ? locale : defaultLocale);
  const toolGroups = groupToolsByCategory(tools);

  // État du mégamenu desktop : piloté pour la navigation clavier (aria-expanded,
  // Échap). Le hover souris reste géré en CSS (group-hover) pour fluidité, et le
  // panneau est TOUJOURS rendu dans le DOM (crawlers) — seule sa visibilité
  // change. forceOpen ouvre via focus/clic clavier indépendamment du hover.
  const [megaOpen, setMegaOpen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);

  // Menu burger mobile + section outils repliable dedans.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Échap ferme le mégamenu desktop et rend le focus au déclencheur.
  useEffect(() => {
    if (!megaOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMegaOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (megaRef.current && !megaRef.current.contains(event.target as Node)) {
        setMegaOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [megaOpen]);

  // Échap ferme le menu mobile.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const navLinkClass =
    "px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Logo href={homeHref} size="md" />
          <nav className="hidden lg:flex items-center gap-1">
            {/* « Fonctionnalités » : mégamenu déroulant listant tous les outils
                groupés par catégorie. Le panneau reste dans le DOM (masqué via
                CSS) pour que les crawlers voient le maillage interne depuis
                chaque page. group-hover (souris) + focus-within / megaOpen
                (clavier) pilotent la visibilité. */}
            <div
              ref={megaRef}
              className="group relative"
              onMouseEnter={() => setMegaOpen(true)}
              onMouseLeave={() => setMegaOpen(false)}
            >
              <Link
                href="/tools"
                className={`${navLinkClass} inline-flex items-center gap-1`}
                aria-haspopup="true"
                aria-expanded={megaOpen}
                onFocus={() => setMegaOpen(true)}
                onClick={() => setMegaOpen(false)}
              >
                {t("nav.features")}
                <ChevronDown
                  className="h-4 w-4 transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180"
                  aria-hidden="true"
                />
              </Link>

              <div
                className={`invisible absolute left-0 top-full z-50 pt-2 opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
                  megaOpen ? "!visible !opacity-100" : ""
                }`}
              >
                <div className="w-[min(72rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-6 shadow-2xl">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-3 lg:grid-cols-5">
                    {toolGroups.map(([category, items]) => (
                      <div key={category}>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`toolsMenu.categories.${category}`)}
                        </p>
                        <ul className="space-y-1">
                          {items.map((tool) => (
                            <li key={tool.slug}>
                              <Link
                                href={`/tools/${tool.slug}`}
                                className="group/item flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                              >
                                <ToolIcon
                                  name={tool.icon}
                                  className="h-4 w-4 shrink-0 text-primary/70 group-hover/item:text-primary"
                                />
                                <span className="truncate">{tool.name}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 border-t border-border pt-4">
                    <Link
                      href="/tools"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      {t("toolsMenu.viewAll")}
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* « Moteur PDF » : page produit détaillant le moteur maison. */}
            <Link href="/engine" className={navLinkClass}>
              {t("nav.engine")}
            </Link>
            <Link href="/open-source" className={navLinkClass}>
              {t("nav.openSource")}
            </Link>
            {/* Ancre in-page : <a> natif locale-aware (le <Link> next-intl ne
                scrolle pas vers un hash same-page). */}
            <a href={`${homeHref}#pricing`} className={navLinkClass}>
              {t("nav.pricing")}
            </a>
            <a
              href="https://github.com/QrCommunication/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
              className={`${navLinkClass} flex items-center gap-1.5`}
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <PublicLanguageSwitcher />
          <div className="hidden sm:flex items-center gap-2 ml-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {t("nav.signIn")}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="lp-press">
                {t("nav.getStarted")}
              </Button>
            </Link>
          </div>
          {/* Déclencheur du menu burger (mobile / tablette). */}
          <button
            type="button"
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("nav.features")}
            aria-haspopup="true"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Panneau mobile : navigation complète + section outils repliable. */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border/50 bg-background">
          <nav className="container mx-auto flex flex-col gap-1 px-4 py-4">
            {/* Section outils repliable. */}
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                aria-expanded={mobileToolsOpen}
                onClick={() => setMobileToolsOpen((open) => !open)}
              >
                {t("nav.features")}
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    mobileToolsOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>
              {mobileToolsOpen && (
                <div className="mt-1 space-y-4 pl-3">
                  {toolGroups.map(([category, items]) => (
                    <div key={category}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t(`toolsMenu.categories.${category}`)}
                      </p>
                      <ul className="space-y-0.5">
                        {items.map((tool) => (
                          <li key={tool.slug}>
                            <Link
                              href={`/tools/${tool.slug}`}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => setMobileOpen(false)}
                            >
                              <ToolIcon
                                name={tool.icon}
                                className="h-4 w-4 shrink-0 text-primary/70"
                              />
                              <span>{tool.name}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <Link
                    href="/tools"
                    className="inline-flex items-center gap-1.5 px-2 text-sm font-medium text-primary hover:underline"
                    onClick={() => setMobileOpen(false)}
                  >
                    {t("toolsMenu.viewAll")}
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/engine"
              className={navLinkClass}
              onClick={() => setMobileOpen(false)}
            >
              {t("nav.engine")}
            </Link>
            <Link
              href="/open-source"
              className={navLinkClass}
              onClick={() => setMobileOpen(false)}
            >
              {t("nav.openSource")}
            </Link>
            <a
              href={`${homeHref}#pricing`}
              className={navLinkClass}
              onClick={() => setMobileOpen(false)}
            >
              {t("nav.pricing")}
            </a>
            <a
              href="https://github.com/QrCommunication/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
              className={`${navLinkClass} flex items-center gap-1.5`}
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>

            <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-3 sm:hidden">
              <Link href="/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" size="sm" className="w-full">
                  {t("nav.signIn")}
                </Button>
              </Link>
              <Link href="/register" className="flex-1" onClick={() => setMobileOpen(false)}>
                <Button size="sm" className="w-full lp-press">
                  {t("nav.getStarted")}
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
