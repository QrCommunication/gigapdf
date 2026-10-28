import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Long date in the UI language (`useLocale()` in components). The locale is
 * required: it used to be hard-coded to "en-US", so French users read
 * "October 27, 2026" on every document card.
 */
export function formatDate(date: Date | string, locale: string): string {
  return new Date(date).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/**
 * File size in the UI language: "1,5 Mo" in French, "1.5 MB" in English.
 * Unit names come from Intl (CLDR), so every locale gets its own symbols
 * (o/ko/Mo/Go in French). Binary multiples (1024), as the app always used.
 * Returns "—" for a missing or invalid size.
 */
export function formatBytes(bytes: number, locale: string, maximumFractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";

  const exponent =
    bytes < 1 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: BYTE_UNITS[exponent],
    unitDisplay: "short",
    maximumFractionDigits: exponent === 0 ? 0 : maximumFractionDigits,
  }).format(bytes / 1024 ** exponent);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}
