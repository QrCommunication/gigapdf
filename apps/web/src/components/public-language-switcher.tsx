"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeNames, localeFlags, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale";
import { Globe } from "lucide-react";

/**
 * Variante PUBLIQUE du sélecteur de langue — pages sous app/[locale] uniquement
 * (landing, (auth), (legal)). Elle bascule l'URL via le routing next-intl
 * (/x ↔ /en/x) ET synchronise le cookie `locale` (setLocale) pour que le
 * dashboard — résolu par cookie, hors [locale] — reste dans la même langue.
 *
 * Le dashboard, lui, continue d'utiliser LanguageSwitcher (cookie seul).
 */
export function PublicLanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newLocale: Locale) => {
    startTransition(async () => {
      // Cookie d'abord (préférence app), puis bascule d'URL localisée.
      await setLocale(newLocale);
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
        disabled={isPending}
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline">{localeFlags[locale]} {localeNames[locale]}</span>
        <span className="sm:hidden">{localeFlags[locale]}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 py-1 bg-popover border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[140px]">
        {locales.map((l) => (
          <button
            key={l}
            onClick={() => handleChange(l)}
            disabled={isPending || l === locale}
            className={`w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors flex items-center gap-2 ${
              l === locale ? "bg-muted font-medium" : ""
            }`}
          >
            <span>{localeFlags[l]}</span>
            <span>{localeNames[l]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
