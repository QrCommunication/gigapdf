"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTranslations } from "next-intl";

const themes = [
  { value: "light", icon: Sun, labelKey: "light" },
  { value: "dark", icon: Moon, labelKey: "dark" },
  { value: "system", icon: Monitor, labelKey: "system" },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("theme");

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-muted/50">
        <div className="h-4 w-4 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  const currentTheme = themes.find((t) => t.value === theme) || themes[0];
  const CurrentIcon = currentTheme.icon;

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
        aria-label={t("toggle")}
      >
        <CurrentIcon className="h-4 w-4" />
        <span className="hidden sm:inline">{t(currentTheme.labelKey)}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 py-1 bg-popover border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[140px]">
        {themes.map((themeOption) => {
          const Icon = themeOption.icon;
          return (
            <button
              key={themeOption.value}
              onClick={() => setTheme(themeOption.value)}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors flex items-center gap-2 ${
                theme === themeOption.value ? "bg-muted font-medium" : ""
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t(themeOption.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
