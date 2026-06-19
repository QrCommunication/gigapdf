"use client";

/**
 * État d'erreur SOBRE du périmètre applicatif ((app)/*) : 404 et 403.
 *
 * Cohérent avec le dashboard (même traitement visuel que l'écran d'erreur de
 * documents/[id] : icône dans une pastille `bg-muted`, titre, description,
 * actions). Réutilisable par `(app)/not-found.tsx`, `(app)/403/page.tsx`, et
 * tout boundary qui veut afficher un refus d'accès in-app.
 *
 * Client component : NextIntl (`useTranslations`) + boutons + liens. Les liens
 * pointent vers des routes app (/dashboard, /documents, /shared) qui vivent
 * HORS du segment [locale] → next/link, jamais le Link i18n.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, FileX, LayoutDashboard, Lock, Users } from "lucide-react";
import { Button } from "@giga-pdf/ui";

type AppErrorVariant = "notFound" | "forbidden";

interface AppErrorStateProps {
  variant: AppErrorVariant;
}

export function AppErrorState({ variant }: AppErrorStateProps) {
  const t = useTranslations(`errors.app.${variant}`);
  const Icon = variant === "forbidden" ? Lock : FileX;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      </div>

      <p className="font-mono text-sm font-medium text-muted-foreground">
        {t("code")}
      </p>

      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
        {variant === "forbidden" ? (
          <p className="text-sm text-muted-foreground/80">{t("ownerHint")}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/dashboard">
          <Button className="gap-2">
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            {t("backDashboard")}
          </Button>
        </Link>

        {variant === "forbidden" ? (
          <Link href="/shared">
            <Button variant="outline" className="gap-2">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t("browseShared")}
            </Button>
          </Link>
        ) : (
          <Link href="/documents">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("browseDocuments")}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

export type { AppErrorVariant };
