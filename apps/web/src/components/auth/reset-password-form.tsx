"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { resetPassword } from "@/lib/auth-client";
import { Button } from "@giga-pdf/ui";
import { Input } from "@giga-pdf/ui";
import { Label } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Alert, AlertDescription } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";

export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const tForgot = useTranslations("auth.forgotPassword");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Better Auth lands here with ?token=... on success, or ?error=INVALID_TOKEN
  // (callbackURL redirect) when the link is expired/invalid.
  const token = searchParams?.get("token") ?? "";
  const linkError = searchParams?.get("error");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(linkError ? t("errors.invalidToken") : "");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError(t("errors.invalidToken"));
      return;
    }
    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await resetPassword({ newPassword: password, token });

      if (result.error) {
        const message = (result.error.message || "").toLowerCase();
        if (message.includes("token") || message.includes("invalid") || message.includes("expired")) {
          setError(t("errors.invalidToken"));
        } else {
          setError(result.error.message || t("errors.generic"));
        }
      } else {
        setSuccess(true);
        // Send the user to login after a short confirmation pause.
        setTimeout(() => router.push("/login"), 2500);
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold">{t("title")}</CardTitle>
          <PublicLanguageSwitcher />
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert>
              <AlertDescription>{t("success.description")}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isLoading || success}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder={t("confirmPasswordPlaceholder")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              disabled={isLoading || success}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={isLoading || success}>
            {isLoading ? t("submitting") : success ? t("success.title") : t("submit")}
          </Button>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {tForgot("backToLogin")}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
