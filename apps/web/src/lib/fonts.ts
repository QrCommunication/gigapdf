import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";

// ---------------------------------------------------------------------------
// Polices partagées par TOUS les root layouts ((site)/[locale], (app),
// (embed), public) et le 404 global. Pattern Next.js « font definitions
// file » : une seule déclaration par police, donc une seule instance chargée
// et des variables CSS garanties identiques entre les périmètres (globals.css
// s'appuie sur --font-geist-sans, --font-geist-mono et --font-bricolage).
// ---------------------------------------------------------------------------

export const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

/** Classes qui déclarent les trois variables CSS de police, à poser sur <body>. */
export const fontVariables = `${geistSans.variable} ${geistMono.variable} ${bricolage.variable}`;
