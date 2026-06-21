"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { setApiConfig, QueryProvider } from "@giga-pdf/api";

// Lazy load ThemeProvider to avoid SSG issues
const DynamicThemeProvider = dynamic(
  () => import("next-themes").then((mod) => mod.ThemeProvider),
  { ssr: false }
);

// Configure API client with Next.js environment variables
function ApiConfigProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    // Set API configuration from Next.js environment variables. This runs in the
    // browser, so fall back to the CURRENT ORIGIN (prod: https://giga-pdf.com)
    // instead of the internal dev URL — NEXT_PUBLIC_API_URL is inlined at build
    // time and, when unset, the old localhost:8000 fallback leaked into the
    // bundle and got blocked by CSP (editor layers + fonts). Dev sets the var
    // explicitly, so this fallback is prod/same-origin only.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

    setApiConfig({
      baseURL: `${apiUrl}/api/v1`,
      websocketURL: wsUrl,
    });
  }, []);

  return <>{children}</>;
}

export function Providers({ children }: { children?: React.ReactNode }) {
  return (
    <QueryProvider>
      <DynamicThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <ApiConfigProvider>{children as React.ReactNode}</ApiConfigProvider>
      </DynamicThemeProvider>
    </QueryProvider>
  );
}
