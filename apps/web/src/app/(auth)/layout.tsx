"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function AuthLayout(props: {
  children?: React.ReactNode;
}) {
  const t = useTranslations();

  return (
    <div className="flex min-h-screen flex-col relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-grid-dots opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />

      {/* Animated orbs */}
      <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-accent/10 rounded-full blur-3xl animate-float" style={{ animationDelay: "-3s" }} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-4 md:p-6">
        <Logo href="/" size="md" />
        <ThemeSwitcher />
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex flex-1 items-center justify-center p-4">
        {props.children}
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-4 md:p-6 text-center">
        <p className="text-xs text-muted-foreground font-mono">
          <span className="text-terminal-green">$</span> GigaPDF{" "}
          <span className="text-muted-foreground/50">|</span>{" "}
          <Link href="/terms" className="hover:text-foreground transition-colors">
            {t("landing.footer.company.terms")}
          </Link>{" "}
          <span className="text-muted-foreground/50">&</span>{" "}
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            {t("landing.footer.company.privacy")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
