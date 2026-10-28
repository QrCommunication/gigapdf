import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { fontVariables } from "@/lib/fonts";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// ROOT LAYOUT #4 — éditeur EMBARQUABLE (/embed), servi dans des iframes tierces.
//
// Root layout dédié (rend <html>/<body>) plutôt qu'un layout imbriqué sous
// (app) : imbriqué, il produisait des <html>/<body> en double (HTML invalide),
// montait Providers deux fois et héritait de la palette Ctrl/Cmd+K et du
// Toaster du dashboard, qui n'ont rien à faire dans la page d'un intégrateur.
//
// Pas de <Toaster /> : ni l'éditeur embarqué ni les composants qu'il monte
// n'appellent toast()/useToast() ; les erreurs remontent à la page hôte via
// postMessage.
//
// Locale : celle de la requête (request.ts : cookie, puis Accept-Language —
// le cookie est généralement absent dans une iframe cross-site). La langue
// demandée par le SDK (`?locale=`) n'est pas lisible ici (un layout n'a pas
// accès aux searchParams) : la page la pose sur son propre sous-arbre
// (provider de messages + attribut lang).
//
// Dynamique : validation de la clé d'API et locale par cookie à chaque requête.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GigaPDF Embed",
  robots: { index: false, follow: false },
};

export default async function EmbedRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${fontVariables} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
