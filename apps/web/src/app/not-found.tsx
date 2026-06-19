import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppErrorState } from "@/components/dashboard/app-error-state";
import { MarketingError } from "@/components/seo/error-marketing";
import { isSeoLocale } from "@/lib/seo";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// 404 GLOBAL (root) — filet pour TOUTE URL inconnue, périmètre public ET app.
//
// Pourquoi ici et pas seulement dans les groupes : avec deux root layouts +
// un segment dynamique [locale], une URL qui ne résout AUCUNE page (ex.
// /en/nope, /dashboard/zzz) ne « matche puis notFound() » pas un segment — elle
// remonte au /_not-found GLOBAL. Les not-found.tsx des groupes ((site)/[locale],
// (app)) ne couvrent QUE les `notFound()` explicites de leurs pages matchées.
// Ce fichier est donc le SEUL à intercepter les URL réellement absentes.
//
// Rendu HORS de tout layout → on fournit nous-mêmes <html>/<body>, les polices
// et le provider NextIntl. La locale vient du cookie / Accept-Language
// (request.ts, hors segment [locale]).
//
// Scope : un visiteur authentifié (cookie de session présent) voit le 404 SOBRE
// du dashboard ; sinon le 404 MARKETING orienté conversion. Le statut HTTP reste
// 404 (Next sert ce composant avec le bon code).
// ---------------------------------------------------------------------------

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

/** Mêmes cookies de session que proxy.ts : présence = utilisateur connecté. */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session",
  "__Secure-better-auth.session",
];

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const messages = await getMessages();
  const seoLocale = isSeoLocale(locale) ? locale : "fr";

  const cookieStore = await cookies();
  const isAuthenticated = SESSION_COOKIE_NAMES.some(
    (name) => cookieStore.get(name)?.value,
  );

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {isAuthenticated ? (
            <AppErrorState variant="notFound" />
          ) : (
            <MarketingError locale={seoLocale} variant="notFound" />
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
