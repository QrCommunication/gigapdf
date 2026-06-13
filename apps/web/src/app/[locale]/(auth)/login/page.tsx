import { LoginForm } from "@/components/auth/login-form";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login.meta");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function LoginPage() {
  return <LoginForm />;
}
