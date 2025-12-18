"use client";

import { Bell, LogOut, User } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";

export function AdminHeader() {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center px-6">
        <div className="flex flex-1 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="GigaPDF"
                width={120}
                height={54}
                className="h-8 w-auto"
                priority
              />
              <span className="text-sm font-medium text-muted-foreground">Admin</span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <LanguageSwitcher />

            <button className="relative rounded-full p-2 hover:bg-accent" title={t("notifications")}>
              <Bell className="h-5 w-5" />
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>

            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{t("superAdmin")}</span>
                <span className="text-xs text-muted-foreground">
                  admin@gigapdf.com
                </span>
              </div>
            </div>

            <Link
              href="/login"
              className="rounded-full p-2 hover:bg-accent"
              title={t("logout")}
            >
              <LogOut className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
