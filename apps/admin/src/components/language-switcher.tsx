"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { Globe, Check, ChevronDown } from "lucide-react";
import { locales, localeNames, localeFlags, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale";

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLocaleChange = (newLocale: Locale) => {
    setIsOpen(false);
    startTransition(() => {
      setLocale(newLocale);
    });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline-block">
          {localeFlags[locale]} {localeNames[locale]}
        </span>
        <span className="sm:hidden">{localeFlags[locale]}</span>
        <ChevronDown className={`h-3 w-3 opacity-50 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-40 rounded-md border bg-background shadow-lg z-50">
          <div className="py-1">
            {locales.map((l) => (
              <button
                key={l}
                onClick={() => handleLocaleChange(l)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <span>{localeFlags[l]}</span>
                <span>{localeNames[l]}</span>
                {locale === l && <Check className="h-4 w-4 ml-auto text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
