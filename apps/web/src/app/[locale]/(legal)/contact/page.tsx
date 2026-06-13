import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import ContactContent from "./contact-content";

interface ContactPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/contact", locale) };
}

export default async function ContactPage({ params }: ContactPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ContactContent />;
}
