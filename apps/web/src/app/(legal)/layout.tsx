"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@giga-pdf/ui";
import { Heart } from "lucide-react";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Logo href="/" size="md" />
          <div className="flex items-center gap-2 md:gap-4">
            <ThemeSwitcher />
            <LanguageSwitcher />
            <Link href="/login">
              <Button variant="ghost">Connexion</Button>
            </Link>
            <Link href="/register">
              <Button>Commencer</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/about" className="hover:text-foreground">
                À propos
              </Link>
              <Link href="/privacy" className="hover:text-foreground">
                Confidentialité
              </Link>
              <Link href="/terms" className="hover:text-foreground">
                CGU
              </Link>
              <Link href="/contact" className="hover:text-foreground">
                Contact
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">
              GigaPDF - Fait avec <Heart className="h-4 w-4 inline text-red-500 fill-red-500" /> par la communauté open source
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
