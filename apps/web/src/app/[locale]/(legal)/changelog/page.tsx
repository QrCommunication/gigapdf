import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import ChangelogContent from "./changelog-content";

interface ChangelogPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ChangelogPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/changelog", locale) };
}

export default async function ChangelogPage({ params }: ChangelogPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ChangelogContent />;
}
