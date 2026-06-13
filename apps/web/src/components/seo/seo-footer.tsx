/**
 * Footer sobre et autonome pour les pages SEO (/tools, /solutions, /en/*).
 * Server component pur, dictionnaire fr/en interne, découplé du Footer de la
 * landing. Liens internes via le Link i18n (@/i18n/navigation) : préfixe /en
 * automatique selon la locale courante.
 */

import { Link } from "@/i18n/navigation";
import type { SeoLocale } from "@/lib/seo";

const GITHUB_URL = "https://github.com/ronylicha/gigapdf";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const COPY: Record<
  SeoLocale,
  { tagline: string; agpl: string; columns: FooterColumn[] }
> = {
  fr: {
    tagline:
      "Plateforme PDF complète, 100 % open source (AGPL) et auto-hébergeable : édition, signature, OCR, conversion et GED.",
    agpl: "GigaPDF — Logiciel libre sous licence AGPL-3.0. Vos documents vous appartiennent.",
    columns: [
      {
        title: "Produit",
        links: [
          { href: "/tools", label: "Outils PDF" },
          { href: "/solutions", label: "Solutions métiers" },
          { href: "/#pricing", label: "Tarifs" },
          { href: "/changelog", label: "Changelog" },
        ],
      },
      {
        title: "Ressources",
        links: [
          { href: "/docs", label: "Documentation" },
          { href: GITHUB_URL, label: "Code source (GitHub)", external: true },
          { href: "/contact", label: "Contact" },
          { href: "/about", label: "À propos" },
        ],
      },
      {
        title: "Légal",
        links: [
          { href: "/legal-notice", label: "Mentions légales" },
          { href: "/privacy", label: "Confidentialité" },
          { href: "/terms", label: "Conditions d'utilisation" },
          { href: "/cookies", label: "Cookies" },
        ],
      },
    ],
  },
  en: {
    tagline:
      "A complete PDF platform, 100% open source (AGPL) and self-hostable: editing, signing, OCR, conversion and document management.",
    agpl: "GigaPDF — Free software under the AGPL-3.0 license. Your documents belong to you.",
    columns: [
      {
        title: "Product",
        links: [
          { href: "/tools", label: "PDF Tools" },
          { href: "/solutions", label: "Business solutions" },
          { href: "/#pricing", label: "Pricing" },
          { href: "/changelog", label: "Changelog" },
        ],
      },
      {
        title: "Resources",
        links: [
          { href: "/docs", label: "Documentation" },
          { href: GITHUB_URL, label: "Source code (GitHub)", external: true },
          { href: "/contact", label: "Contact" },
          { href: "/about", label: "About" },
        ],
      },
      {
        title: "Legal",
        links: [
          { href: "/legal-notice", label: "Legal notice" },
          { href: "/privacy", label: "Privacy" },
          { href: "/terms", label: "Terms of use" },
          { href: "/cookies", label: "Cookies" },
        ],
      },
    ],
  },
};

interface SeoFooterProps {
  locale: SeoLocale;
}

export function SeoFooter({ locale }: SeoFooterProps) {
  const copy = COPY[locale];

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-sm font-semibold text-foreground">GigaPDF</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">{copy.tagline}</p>
          </div>
          {copy.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-sm font-semibold text-foreground">{column.title}</p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">{copy.agpl}</p>
        </div>
      </div>
    </footer>
  );
}
