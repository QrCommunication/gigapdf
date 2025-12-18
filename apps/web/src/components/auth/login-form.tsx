"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
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

export function LoginForm() {
  const t = useTranslations("auth.login");
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const redirectTo = searchParams?.get("from") || "/dashboard";

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        const errorMessage = result.error.message || "";
        // Check if email is not verified
        if (
          errorMessage.toLowerCase().includes("not verified") ||
          errorMessage.toLowerCase().includes("email verification")
        ) {
          // Redirect to verify-email page
          window.location.href = `/verify-email?email=${encodeURIComponent(email)}`;
          return;
        }
        setError(errorMessage || t("errors.invalidCredentials"));
        setIsLoading(false);
      } else {
        // Use window.location for a full page navigation to ensure cookies are set
        window.location.href = redirectTo;
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t("errors.generic");
      setError(errorMessage);
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
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {t("forgotPassword")}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? t("submitting") : t("submit")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href="/register" className="text-primary hover:underline">
              {t("signUp")}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
