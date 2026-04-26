"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { Heart, Github, ExternalLink } from "lucide-react";

export function Footer() {
  const t = useTranslations();
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "https://giga-pdf.com";

  return (
    <footer className="border-t border-border py-16 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Logo href="/" size="sm" />
            <p className="text-sm text-muted-foreground mt-4 mb-6 max-w-xs">
              {t("landing.footer.tagline")}
            </p>
            <div className="flex gap-4">
              <a
                href="https://github.com/QrCommunication/gigapdf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              {t("landing.footer.product.title")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/#features" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t("landing.footer.product.features")}
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t("landing.footer.product.pricing")}
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t("landing.footer.product.documentation")}
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t("landing.footer.product.changelog")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Open Source Links */}
          <div>
            <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              {t("landing.footer.openSource.title")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href="https://github.com/QrCommunication/gigapdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  {t("landing.footer.openSource.repository")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/QrCommunication/gigapdf/blob/main/CONTRIBUTING.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  {t("landing.footer.openSource.contributing")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/QrCommunication/gigapdf/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  {t("landing.footer.openSource.license")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${apiBaseUrl}/api/docs`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  Swagger UI
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${apiBaseUrl}/api/redoc`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  ReDoc
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              Légal
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/legal-notice" className="text-muted-foreground hover:text-foreground transition-colors">
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                  CGU
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-muted-foreground hover:text-foreground transition-colors">
                  Cookies
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/QrCommunication/gigapdf/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  AGPL-3.0
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 pt-8 border-t border-border text-center max-w-6xl mx-auto">
          <p className="text-sm text-muted-foreground font-mono">
            <span className="text-terminal-green">$</span> GigaPDF © {new Date().getFullYear()}{" "}
            <span className="text-muted-foreground/60">|</span>{" "}
            {t("landing.footer.madeWith")}{" "}
            <Heart className="h-3.5 w-3.5 inline text-red-500 fill-red-500" />{" "}
            {t("landing.footer.byOpenSource")}
          </p>
        </div>
      </div>
    </footer>
  );
}
