/**
 * Premiers segments de TOUTES les routes (app) — non localisées. Le proxy les
 * sert directement, sans réécriture next-intl : réécrites, elles tomberaient
 * dans le périmètre statique (site)/[locale] et répondraient 404.
 *
 * Doit correspondre exactement aux dossiers de src/app/(app)/(dashboard)/*,
 * src/app/(app)/* (editor, invitations), src/app/(embed)/* (embed) et
 * src/app/public. Le test src/lib/__tests__/app-routes.test.ts le vérifie :
 * /change-password et /flatten ont été en 404 en production parce qu'ils
 * manquaient ici.
 */
export const APP_ROUTES: ReadonlySet<string> = new Set<string>([
  // Conteneurs app
  "dashboard", "documents", "search", "settings", "billing", "organization",
  "developers", "shared", "trash", "forbidden", "editor", "embed",
  // Pages à token, URL nue JAMAIS localisée (liens copiés/e-mailés) :
  // /invitations/[token] (landing invité, sous (app)) et /public/[token]
  // (viewer public sans auth, root layout dédié).
  "invitations", "public",
  // Outils — édition / sécurité / pages
  "merge", "split", "compress", "protect", "unlock", "change-password", "sign",
  "watermark", "ocr", "pdf-a", "flatten", "extract-pages", "organize-pages",
  // Outils — conversion VERS pdf
  "image-to-pdf", "office-to-pdf", "html-to-pdf", "text-to-pdf", "csv-to-pdf",
  "markdown-to-pdf", "rtf-pdf",
  // Outils — conversion DEPUIS pdf
  "pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint", "pdf-to-image",
  "pdf-to-odt", "pdf-to-ods", "pdf-to-odp", "pdf-to-html", "pdf-to-rtf",
  "pdf-to-text", "pdf-to-markdown", "pdf-to-csv", "pdf-to-epub",
]);
