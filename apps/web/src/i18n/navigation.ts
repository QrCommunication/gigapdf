import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * APIs de navigation localisées — à utiliser UNIQUEMENT pour les liens entre
 * pages publiques (landing, (auth), (legal), (seo)).
 * Les liens vers l'app (/dashboard, /documents, /editor…) restent sur
 * next/link et next/navigation : ces routes vivent hors du segment [locale].
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
