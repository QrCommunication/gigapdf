import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";

interface VerifyEmailPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: VerifyEmailPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.verifyEmail.meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicPageAlternates("/verify-email", locale),
  };
}

export default async function VerifyEmailPage({ params }: VerifyEmailPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <VerifyEmailForm />;
}
