"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { setApiConfig } from "@giga-pdf/api";

// Lazy load ThemeProvider to avoid SSG issues
const DynamicThemeProvider = dynamic(
  () => import("next-themes").then((mod) => mod.ThemeProvider),
  { ssr: false }
);

// Configure API client with Next.js environment variables
function ApiConfigProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    // Set API configuration from Next.js environment variables
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

    setApiConfig({
      baseURL: `${apiUrl}/api/v1`,
      websocketURL: wsUrl,
    });
  }, []);

  return <>{children}</>;
}

export function Providers({ children }: { children?: React.ReactNode }) {
  return (
    <DynamicThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <ApiConfigProvider>{children as React.ReactNode}</ApiConfigProvider>
    </DynamicThemeProvider>
  );
}
