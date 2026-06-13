import { LoginForm } from "@/components/auth/login-form";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.login.meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicPageAlternates("/login", locale),
  };
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LoginForm />;
}
