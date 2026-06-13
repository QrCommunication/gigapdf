/** Constantes partagées des pages SEO et du sitemap. */

export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://giga-pdf.com";

/**
 * Date de dernière mise à jour éditoriale du contenu SEO.
 * Constante de build volontairement figée (PAS de Date.now() par requête) :
 * le sitemap doit exposer un lastModified stable entre deux déploiements.
 * À bumper manuellement lors d'une refonte du contenu des pages.
 */
export const SEO_LAST_UPDATE = "2026-06-13";
