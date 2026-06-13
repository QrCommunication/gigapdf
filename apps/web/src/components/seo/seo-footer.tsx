/**
 * Footer sobre et autonome pour les pages SEO (/tools, /solutions).
 * Server component pur, contenu en dur (FR), découplé du Footer de la landing.
 */

import Link from "next/link";

const GITHUB_URL = "https://github.com/ronylicha/gigapdf";

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
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
];

export function SeoFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-sm font-semibold text-foreground">GigaPDF</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Plateforme PDF complète, 100 % open source (AGPL) et
              auto-hébergeable : édition, signature, OCR, conversion et GED.
            </p>
          </div>
          {FOOTER_COLUMNS.map((column) => (
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
          <p className="text-xs text-muted-foreground">
            GigaPDF — Logiciel libre sous licence AGPL-3.0. Vos documents vous
            appartiennent.
          </p>
        </div>
      </div>
    </footer>
  );
}
