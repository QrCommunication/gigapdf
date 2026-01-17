"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@giga-pdf/ui";
import { Github } from "lucide-react";

export function Header() {
  const t = useTranslations();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Logo href="/" size="md" />
          <nav className="hidden lg:flex items-center gap-1">
            <Link
              href="/#features"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.features")}
            </Link>
            <Link
              href="/#open-source"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.openSource")}
            </Link>
            <Link
              href="/#pricing"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {t("nav.pricing")}
            </Link>
            <a
              href="https://github.com/ronylicha/gigapdf"
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
          <LanguageSwitcher />
          <div className="hidden sm:flex items-center gap-2 ml-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {t("nav.signIn")}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="btn-glow">
                {t("nav.getStarted")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
