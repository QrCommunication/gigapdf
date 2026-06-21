"use client";

/**
 * Command Palette globale (Ctrl/Cmd+K) du périmètre authentifié ((app)/*).
 *
 * Montée dans (app)/layout.tsx → couvre dashboard ET éditeur. Trois sources :
 *  1. Une action de recherche sémantique (toujours visible en tête quand
 *     l'input est non vide) → route vers /search?q=… (la page lit ?q=).
 *  2. Les 9 entrées de navigation de la sidebar dashboard.
 *  3. Le catalogue d'outils SEO (getToolsData) → page publique /tools/[slug].
 *
 * Raccourci : Ctrl+K (Win/Linux) OU Cmd/Meta+K (Mac). On détecte l'OS pour
 * AFFICHER le bon hint, mais on accepte les deux modificateurs au clavier.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2,
  Code2,
  CreditCard,
  FileText,
  Home,
  ScanSearch,
  Settings,
  Share2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@giga-pdf/ui";
import { ToolIcon } from "@/components/seo/tool-icon";
import { getToolsData, isSeoLocale, type SeoLocale, localizePath } from "@/lib/seo";

interface NavEntry {
  /** Clé du namespace `nav` pour le libellé. */
  labelKey: string;
  href: string;
  icon: LucideIcon;
}

// Miroir des navItems de la sidebar dashboard (libellés via t('nav.*')).
const NAV_ENTRIES: readonly NavEntry[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: Home },
  { labelKey: "documents", href: "/documents", icon: FileText },
  { labelKey: "semanticSearch", href: "/search", icon: ScanSearch },
  { labelKey: "sharedWithMe", href: "/shared", icon: Share2 },
  { labelKey: "trash", href: "/trash", icon: Trash2 },
  { labelKey: "organization", href: "/organization", icon: Building2 },
  { labelKey: "settings", href: "/settings", icon: Settings },
  { labelKey: "developers", href: "/developers", icon: Code2 },
  { labelKey: "billing", href: "/billing", icon: CreditCard },
];

/** Détecte un environnement macOS pour n'afficher que le hint adéquat. */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData.platform (moderne) sinon userAgent (platform est déprécié).
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const haystack = `${uaPlatform ?? ""} ${navigator.userAgent}`;
  return /mac/i.test(haystack);
}

export function CommandPalette() {
  const t = useTranslations("commandPalette");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const locale = useLocale();
  const seoLocale: SeoLocale = isSeoLocale(locale) ? locale : "fr";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isMac, setIsMac] = useState(false);

  // Détection OS côté client uniquement (évite tout mismatch d'hydratation).
  useEffect(() => {
    setIsMac(isMacPlatform());
  }, []);

  // Listener global : ouvre/ferme sur Ctrl+K (Win/Linux) ou Cmd/Meta+K (Mac).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const closeAndReset = () => {
    setOpen(false);
    setQuery("");
  };

  const navigateTo = (href: string) => {
    closeAndReset();
    router.push(href);
  };

  const trimmedQuery = query.trim();
  const tools = getToolsData(seoLocale);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <CommandInput
        placeholder={t("placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("noResults")}</CommandEmpty>

        {trimmedQuery.length > 0 && (
          <>
            <CommandGroup heading={t("groups.search")}>
              {/*
                Item d'action recherche sémantique : forceMount le garde monté,
                et un `value` qui inclut le query courant garantit que le filtre
                interne de cmdk le matche TOUJOURS (il n'est jamais éliminé tant
                que l'input est non vide).
              */}
              <CommandItem
                forceMount
                value={`search-documents ${trimmedQuery}`}
                onSelect={() =>
                  navigateTo(`/search?q=${encodeURIComponent(trimmedQuery)}`)
                }
              >
                <ScanSearch className="h-4 w-4" aria-hidden="true" />
                <span>{t("searchInDocuments", { query: trimmedQuery })}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading={t("groups.navigation")}>
          {NAV_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            const label = tNav(entry.labelKey);
            return (
              <CommandItem
                key={entry.href}
                value={`nav ${label}`}
                onSelect={() => navigateTo(entry.href)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("groups.tools")}>
          {tools.map((tool) => {
            const href = localizePath(`/tools/${tool.slug}`, seoLocale);
            return (
              <CommandItem
                key={tool.slug}
                value={`tool ${tool.name}`}
                onSelect={() => navigateTo(href)}
              >
                <ToolIcon name={tool.icon} className="h-4 w-4" />
                <span>{tool.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>

      <div className="flex items-center justify-end gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>{t("toggleHint")}</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
          {isMac ? "⌘K" : "Ctrl+K"}
        </kbd>
      </div>
    </CommandDialog>
  );
}
