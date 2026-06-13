import { RegisterForm } from "@/components/auth/register-form";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";

interface RegisterPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.register.meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicPageAlternates("/register", locale),
  };
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <RegisterForm />;
}
