import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { solutionSlugMap, toolSlugMap } from "./lib/seo/slug-map";

// Ensembles de slugs SEO valides PAR LOCALE (clés = slugs fr, valeurs = slugs en).
// Servent à produire de VRAIS 404 sur les slugs croisés/inconnus : notFound()
// dans une page dynamique [slug] ne renvoie qu'un soft-404 (HTTP 200) sous le
// streaming Next 16, toxique pour le SEO. Le proxy réécrit donc vers un chemin
// sans route → 404 natif (statut correct + page not-found rendue).
const SEO_SLUGS: Record<"fr" | "en", Record<"tools" | "solutions", Set<string>>> = {
  fr: {
    tools: new Set(Object.keys(toolSlugMap)),
    solutions: new Set(Object.keys(solutionSlugMap)),
  },
  en: {
    tools: new Set(Object.values(toolSlugMap)),
    solutions: new Set(Object.values(solutionSlugMap)),
  },
};

const SEO_DETAIL_RE = /^\/(tools|solutions)\/([^/]+)\/?$/;

/**
 * Proxy Next.js 16 — périmètre PUBLIC uniquement.
 *
 * Rôles :
 * 1. Routing i18n next-intl (préfixe `as-needed` : fr sans préfixe, en = /en/*)
 *    sur la landing, (auth), (legal) et (seo). Le proxy réécrit `/x` vers
 *    `/fr/x` en interne et pose le header X-NEXT-INTL-LOCALE consommé par
 *    src/i18n/request.ts.
 * 2. Redirection des utilisateurs déjà authentifiés hors des pages d'auth
 *    (login/register/forgot-password → /dashboard) — logique héritée de
 *    l'ancien apps/web/proxy.ts (qui était inactif : avec un répertoire src/,
 *    Next.js ne charge le proxy que depuis src/proxy.ts).
 *
 * Le matcher EXCLUT volontairement : /api, /backend-api, /embed, toutes les
 * routes app (/dashboard, /documents, /editor, /settings, /billing,
 * /organization, /developers, /shared, /trash, /monitoring), /_next et les
 * fichiers statiques. Ces routes conservent la résolution de locale par
 * cookie (request.ts) et la protection client AuthGuard.
 */

const intlMiddleware = createIntlMiddleware(routing);

/** Pages d'auth : un utilisateur déjà connecté est renvoyé vers le dashboard. */
const AUTH_ROUTES = ["/login", "/register", "/forgot-password"];

function getSessionToken(request: NextRequest) {
  const possibleCookieNames = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session",
    "__Secure-better-auth.session",
  ];

  for (const cookieName of possibleCookieNames) {
    const cookie = request.cookies.get(cookieName);
    if (cookie?.value) {
      return cookie;
    }
  }
  return null;
}

/** Ramène /en/login → /login (et /en → /) pour comparer aux routes d'auth. */
function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

export function proxy(request: NextRequest) {
  const original = request.nextUrl.pathname;
  const pathname = stripLocalePrefix(original);

  if (AUTH_ROUTES.includes(pathname) && getSessionToken(request)) {
    // /dashboard vit hors [locale] : URL non préfixée, jamais localisée.
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Validation des slugs SEO → 404 natif sur slug croisé (fr sous /en ou
  // inversement) ou inconnu. La page [slug] appelle bien notFound(), mais en
  // dynamique Next 16 cela ne donne qu'un 200 « soft-404 ». On réécrit vers
  // /{locale}/__not-found__ : [locale] est valide mais aucun enfant ne matche
  // → 404 natif (cf. /foobar). Les hubs /tools et /solutions ne matchent pas
  // la regex (pas de segment slug) et passent normalement.
  const seoMatch = pathname.match(SEO_DETAIL_RE);
  if (seoMatch) {
    const kind = seoMatch[1] as "tools" | "solutions";
    const slug = seoMatch[2]!;
    const locale: "fr" | "en" =
      original === "/en" || original.startsWith("/en/") ? "en" : "fr";
    if (!SEO_SLUGS[locale][kind].has(slug)) {
      return NextResponse.rewrite(new URL(`/${locale}/__not-found__`, request.url));
    }
  }

  return intlMiddleware(request);
}

export const config = {
  // Matcher NÉGATIF : tout SAUF les routes app/API/fichiers. Deux raisons :
  // 1. Le périmètre public (landing, auth, legal, seo, /(fr|en)/*) doit passer
  //    par le routing i18n next-intl.
  // 2. Toute URL inconnue (/foobar, /xx/login) doit AUSSI passer par le proxy :
  //    next-intl la réécrit vers /fr/<path>, qui ne matche aucune route → 404
  //    routing natif. Sans cela, /foobar tombe sur le segment [locale]
  //    (locale="foobar") et la garde hasLocale() du layout throw APRÈS le
  //    premier flush du stream → soft-404 en status 200 (toxique SEO).
  // Exclusions = routes app ((dashboard), editor, embed), API, assets : elles
  // conservent la résolution de locale par cookie (request.ts) et ne sont
  // JAMAIS préfixées.
  matcher: [
    "/((?!api|backend-api|dashboard|documents|editor|settings|billing|organization|developers|shared|trash|monitoring|embed|_next|_vercel|.*\\..*).*)",
  ],
};
