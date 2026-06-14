import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";

interface EmbedDocsPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * La doc du widget d'intégration (@giga-pdf/embed) est MASQUÉE tant que l'embed
 * SDK n'est pas publié : la page redirige vers /docs en attendant. Le contenu
 * complet reste dans `embed-docs-content.tsx` ; pour le réactiver, restaurer le
 * rendu de <EmbedDocsContent /> + generateMetadata, la carte dans
 * docs-content.tsx et l'entrée sitemap.
 */
export default async function EmbedDocsPage({ params }: EmbedDocsPageProps) {
  const { locale } = await params;
  redirect(locale === defaultLocale ? "/docs" : `/${locale}/docs`);
}
