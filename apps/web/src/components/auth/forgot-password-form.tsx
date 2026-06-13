"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { forgetPassword } from "@/lib/auth-client";
import { Button } from "@giga-pdf/ui";
import { Input } from "@giga-pdf/ui";
import { Label } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Alert, AlertDescription } from "@giga-pdf/ui";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setIsLoading(true);

    try {
      const result = await forgetPassword({
        email,
        redirectTo: "/reset-password",
      });

      if (result.error) {
        const message = result.error.message;
        if (message === "reset_email_failed") {
          setError(t("errors.sendFailed"));
        } else {
          setError(message || t("errors.generic"));
        }
      } else {
        setSuccess(true);
      }
    } catch (err) {
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
          <LanguageSwitcher />
        </div>
        <CardDescription>
          {t("description")}
        </CardDescription>
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
              <AlertDescription>
                {t("success.description")}
              </AlertDescription>
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
            {t("backToLogin")}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
