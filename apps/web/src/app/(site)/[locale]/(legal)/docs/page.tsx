import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import DocsContent from "./docs-content";

interface DocsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: DocsPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/docs", locale) };
}

export default async function DocsPage({ params }: DocsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <DocsContent />;
}
