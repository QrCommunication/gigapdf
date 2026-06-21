import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { publicPageAlternates } from "@/lib/seo/hreflang";

interface ResetPasswordPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ResetPasswordPageProps): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: publicPageAlternates("/reset-password", locale) };
}

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // ResetPasswordForm reads the token via useSearchParams(), which requires a
  // Suspense boundary on a statically-generated page.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
