"use client";

import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1 relative">
        <div className="absolute inset-0 bg-grid-dots opacity-20" />
        <div className="container relative mx-auto px-4 py-16 max-w-4xl">
          <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
            {children}
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
