import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

// Force dynamic for all embed pages (API key validation requires runtime data)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GigaPDF Embed",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Bare embed layout — no header, no sidebar, no footer.
 * Only the providers needed by editor components (ThemeProvider + QueryProvider + ApiConfigProvider).
 * NextIntlClientProvider is intentionally omitted; the embed page handles
 * locale via the `locale` query param passed by the SDK.
 */
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
