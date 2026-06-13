import { MetadataRoute } from "next";
import { SEO_LAST_UPDATE, SITE_URL } from "@/lib/seo/constants";
import { getAllSolutionSlugs } from "@/lib/seo/solutions-data";
import { getAllToolSlugs } from "@/lib/seo/tools-data";

/**
 * Date de build figée (constante module) : le sitemap expose un lastModified
 * stable entre deux déploiements — jamais de Date.now() par requête.
 */
const LAST_UPDATE = new Date(SEO_LAST_UPDATE);

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * Page publique BILINGUE (segment [locale], préfixe `as-needed`) : deux
 * entrées — fr sans préfixe + /en — portant chacune le bloc hreflang complet.
 * Réservé aux pages réellement traduites ; les pages fr-only ((seo) tools et
 * solutions, cookies, legal-notice) ne passent JAMAIS par ce helper : pas
 * d'URL /en (404), pas de hreflang.
 */
function bilingualEntries(
  path: string,
  changeFrequency: ChangeFrequency,
  priority: number,
): MetadataRoute.Sitemap {
  const frUrl = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  const enUrl = path === "/" ? `${SITE_URL}/en` : `${SITE_URL}/en${path}`;
  const languages = { fr: frUrl, en: enUrl, "x-default": frUrl };

  return [frUrl, enUrl].map((url) => ({
    url,
    lastModified: LAST_UPDATE,
    changeFrequency,
    priority,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;

  // Landing + (auth) + (legal) : contenu fr/en sous le segment [locale].
  const staticPages: MetadataRoute.Sitemap = [
    ...bilingualEntries("/", "weekly", 1),
    ...bilingualEntries("/login", "monthly", 0.8),
    ...bilingualEntries("/register", "monthly", 0.8),
    ...bilingualEntries("/about", "monthly", 0.7),
    ...bilingualEntries("/docs", "weekly", 0.7),
    ...bilingualEntries("/changelog", "weekly", 0.6),
    ...bilingualEntries("/privacy", "yearly", 0.5),
    ...bilingualEntries("/terms", "yearly", 0.5),
    ...bilingualEntries("/contact", "monthly", 0.6),
  ];

  // (seo) : contenu rédigé en fr uniquement — /en/tools et /en/solutions
  // répondent 404, donc URLs fr seules, sans alternates.
  const seoHubs: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/tools`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/solutions`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.9,
    },
  ];

  const toolPages: MetadataRoute.Sitemap = getAllToolSlugs().map((slug) => ({
    url: `${baseUrl}/tools/${slug}`,
    lastModified: LAST_UPDATE,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const solutionPages: MetadataRoute.Sitemap = getAllSolutionSlugs().map((slug) => ({
    url: `${baseUrl}/solutions/${slug}`,
    lastModified: LAST_UPDATE,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...seoHubs, ...toolPages, ...solutionPages];
}
