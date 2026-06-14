"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { defaultLocale } from "@/i18n/config";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { Button } from "@giga-pdf/ui";
import { GithubIcon as Github } from "@/components/icons/github-icon";

export function Header() {
  const t = useTranslations();
  const locale = useLocale();
  // Logo (next/link interne, partagé avec le dashboard) : préfixer la cible
  // publique "/" manuellement pour conserver la locale courante (/en).
  const homeHref = locale === defaultLocale ? "/" : `/${locale}`;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Logo href={homeHref} size="md" />
          <nav className="hidden lg:flex items-center gap-1">
            {/* Ancres in-page : <a> natif (scroll hash fiable, même page ET
                cross-page) préfixé par la locale courante. Le <Link> next-intl
                ne déclenche pas le scroll vers un hash same-page. */}
            <a
              href={`${homeHref}#features`}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.features")}
            </a>
            <Link
              href="/open-source"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.openSource")}
            </Link>
            <a
              href={`${homeHref}#pricing`}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.pricing")}
            </a>
            <a
              href="https://github.com/QrCommunication/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted flex items-center gap-1.5"
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
        </div>
      </div>
    </header>
  );
}
