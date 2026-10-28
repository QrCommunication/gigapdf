import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Toaster } from "@giga-pdf/ui";
import { CommandPalette } from "@/components/command/command-palette";
import { Providers } from "@/components/providers";
import { fontVariables } from "@/lib/fonts";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// ROOT LAYOUT #2 — périmètre APPLICATIF authentifié ((app)/*).
//
// Couvre (dashboard), editor et invitations. L'éditeur embarquable (iframe
// tierce) a son propre root layout dans (embed) : il ne doit recevoir ni la
// palette Ctrl/Cmd+K ni le Toaster du dashboard. C'est un VRAI root layout (rend
// <html>/<body>) : il n'y a plus de app/layout.tsx, chaque groupe porte le
// sien. Contrairement au root (site), la locale est résolue par COOKIE via
// getLocale() (request.ts, branche 2+) → ce sous-arbre est intrinsèquement
// dynamique. `force-dynamic` rend cette contrainte explicite et empêche toute
// tentative de pré-rendu (qui planterait en DYNAMIC_SERVER_USAGE sur cookies()).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// Périmètre authentifié (dashboard / editor) : jamais indexé.
// Défense en profondeur au-delà du Disallow robots.txt — le Disallow empêche
// le crawl mais une URL liée ailleurs peut être indexée sans snippet ; le
// noindex meta est le signal le plus fort pour exclure ces pages des SERP.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
        className={`${fontVariables} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            {children}
            {/* Palette Ctrl/Cmd+K globale — couvre dashboard + éditeur. */}
            <CommandPalette />
          </Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
