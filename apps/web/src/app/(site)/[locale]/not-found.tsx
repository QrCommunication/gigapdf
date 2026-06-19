import { getLocale } from "next-intl/server";
import { MarketingError } from "@/components/seo/error-marketing";
import { isSeoLocale } from "@/lib/seo";

// ---------------------------------------------------------------------------
// 404 MARKETING — périmètre public ((site)/[locale]).
//
// Déclenché par le 404 NATIF que produit le root layout statique
// (generateStaticParams + dynamicParams=false) lorsqu'un chemin sans route est
// réécrit par proxy.ts vers /{locale}/<inconnu>. Le statut HTTP reste 404 (pas
// de soft-404) : ce composant ne fait JAMAIS appel à `notFound()` dans une page
// dynamique — il EST la page not-found.
//
// not-found.tsx ne reçoit pas `params` : la locale vient de getLocale() (posée
// par setRequestLocale dans le layout). On retombe sur "fr" si la locale n'est
// pas une SeoLocale (défense, ne devrait pas arriver dans ce sous-arbre).
// ---------------------------------------------------------------------------

export default async function SiteNotFound() {
  const locale = await getLocale();
  const seoLocale = isSeoLocale(locale) ? locale : "fr";

  return <MarketingError locale={seoLocale} variant="notFound" />;
}
