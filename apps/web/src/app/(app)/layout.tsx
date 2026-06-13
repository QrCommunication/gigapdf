import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Toaster } from "@giga-pdf/ui";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// ROOT LAYOUT #2 — périmètre APPLICATIF authentifié ((app)/*).
//
// Couvre (dashboard), editor et embed. C'est un VRAI root layout (rend
// <html>/<body>) : il n'y a plus de app/layout.tsx, chaque groupe porte le
// sien. Contrairement au root (site), la locale est résolue par COOKIE via
// getLocale() (request.ts, branche 2+) → ce sous-arbre est intrinsèquement
// dynamique. `force-dynamic` rend cette contrainte explicite et empêche toute
// tentative de pré-rendu (qui planterait en DYNAMIC_SERVER_USAGE sur cookies()).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// Périmètre authentifié (dashboard / editor / embed) : jamais indexé.
// Défense en profondeur au-delà du Disallow robots.txt — le Disallow empêche
// le crawl mais une URL liée ailleurs peut être indexée sans snippet ; le
// noindex meta est le signal le plus fort pour exclure ces pages des SERP.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
