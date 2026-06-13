import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import TermsContent from "./terms-content";

interface TermsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: TermsPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/terms", locale) };
}

export default async function TermsPage({ params }: TermsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <TermsContent />;
}
