import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import EmbedDocsContent from "./embed-docs-content";

interface EmbedDocsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: EmbedDocsPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/docs/embed", locale) };
}

export default async function EmbedDocsPage({ params }: EmbedDocsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <EmbedDocsContent />;
}
