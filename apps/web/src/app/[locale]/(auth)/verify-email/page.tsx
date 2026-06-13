import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.verifyEmail.meta");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function VerifyEmailPage() {
  return <VerifyEmailForm />;
}
