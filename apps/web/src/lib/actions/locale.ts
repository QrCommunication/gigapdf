"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { locales, type Locale } from "@/i18n/config";

export async function setLocale(locale: Locale) {
  if (!locales.includes(locale)) {
    return { error: "invalid_locale" };
  }

  const cookieStore = await cookies();

  // Set cookie for 1 year
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // Revalidate all pages to refresh with new locale
  revalidatePath("/", "layout");

  return { success: true };
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const locale = cookieStore.get("locale")?.value;

  if (locale && locales.includes(locale as Locale)) {
    return locale as Locale;
  }

  return "fr";
}
