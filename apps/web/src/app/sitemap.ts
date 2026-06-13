import { MetadataRoute } from "next";
import { SEO_LAST_UPDATE, SITE_URL } from "@/lib/seo/constants";
import { getAllSolutionSlugs } from "@/lib/seo/solutions-data";
import { getAllToolSlugs } from "@/lib/seo/tools-data";

/**
 * Date de build figée (constante module) : le sitemap expose un lastModified
 * stable entre deux déploiements — jamais de Date.now() par requête.
 */
const LAST_UPDATE = new Date(SEO_LAST_UPDATE);

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: LAST_UPDATE,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/register`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/docs`,
      lastModified: LAST_UPDATE,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: LAST_UPDATE,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: LAST_UPDATE,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: LAST_UPDATE,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: LAST_UPDATE,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

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
