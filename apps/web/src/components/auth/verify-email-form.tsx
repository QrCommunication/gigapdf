"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { sendVerificationEmail } from "@/lib/auth-client";
import {
  Button,
  Input,
  Label,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
} from "@giga-pdf/ui";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Mail, CheckCircle2, ArrowLeft } from "lucide-react";

export function VerifyEmailForm() {
  const t = useTranslations("auth.verifyEmail");
  const searchParams = useSearchParams();
  const emailFromParams = searchParams?.get("email") || "";
  const verified = searchParams?.get("verified") === "true";

  const [email, setEmail] = useState(emailFromParams);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!email) {
      setError(t("errors.emailRequired"));
      return;
    }

    setIsLoading(true);

    try {
      const result = await sendVerificationEmail({
        email,
      });

      if (result.error) {
        const errorMessage = result.error.message || t("errors.generic");
        if (errorMessage === "verification_email_failed") {
          setError(t("errors.sendFailed"));
        } else if (errorMessage.toLowerCase().includes("already verified")) {
          setError(t("errors.alreadyVerified"));
        } else if (errorMessage.toLowerCase().includes("not found")) {
          setError(t("errors.emailNotFound"));
        } else if (errorMessage.toLowerCase().includes("too many")) {
          setError(t("errors.tooManyRequests"));
        } else {
          setError(errorMessage);
        }
      } else {
        setSuccess(true);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t("errors.generic");
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // If email was just verified (from callback)
  if (verified) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold">{t("verified.title")}</CardTitle>
          <CardDescription>{t("verified.description")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">{t("verified.goToLogin")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // If resend was successful
  if (success) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <Mail className="h-8 w-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl font-bold">{t("success.title")}</CardTitle>
          <CardDescription>{t("success.description")}</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          {t("checkSpam")}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setSuccess(false)}
          >
            {t("submit")}
          </Button>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToLogin")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold">{t("title")}</CardTitle>
          <LanguageSwitcher />
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4 text-center">
          <Mail className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("checkSpam")}</p>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("resendTitle")}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <Link
          href="/login"
          className="mx-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToLogin")}
        </Link>
      </CardFooter>
    </Card>
  );
}
