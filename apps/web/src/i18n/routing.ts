import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

/**
 * Routing i18n du périmètre PUBLIC uniquement (landing, (auth), (legal), (seo)).
 * Les routes applicatives (dashboard, editor, embed, api) restent résolues par
 * cookie via src/i18n/request.ts et ne passent JAMAIS par ce routing.
 *
 * - `as-needed` : fr (défaut) sans préfixe → URLs historiques inchangées ;
 *   en = /en/*.
 * - `localeDetection: false` : l'URL est la SEULE source de vérité publique.
 *   Une détection cookie/Accept-Language ferait fuir les crawlers de / vers
 *   /en et rendrait les URLs publiques instables (cache, partage).
 * - `localeCookie: false` : le cookie `locale` reste écrit exclusivement par
 *   l'action serveur setLocale() (source unique, partagée avec le dashboard).
 * - `alternateLinks: false` : les en-têtes Link automatiques supposeraient un
 *   chemin IDENTIQUE dans les deux locales — faux pour (seo) où les slugs
 *   sont traduits (/tools/editer-pdf ↔ /en/tools/edit-pdf). Les hreflang
 *   restent gérés explicitement (sitemap.ts + metadata des pages, slug-map).
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});
