/**
 * Layout des pages SEO programmatique (/tools, /solutions).
 * Header et footer marketing AUTONOMES (components/seo/) : aucun couplage
 * avec la landing page ni avec les messages next-intl — contenu en dur (FR).
 */

import { SeoFooter } from "@/components/seo/seo-footer";
import { SeoHeader } from "@/components/seo/seo-header";

export default function SeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SeoHeader />
      <main className="flex-1">{children}</main>
      <SeoFooter />
    </div>
  );
}
