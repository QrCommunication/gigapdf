"use client";

import dynamic from "next/dynamic";

// Lazy load ThemeProvider to avoid SSG issues
const DynamicThemeProvider = dynamic(
  () => import("next-themes").then((mod) => mod.ThemeProvider),
  { ssr: false }
);

export function Providers({ children }: { children?: React.ReactNode }) {
  return (
    <DynamicThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children as React.ReactNode}
    </DynamicThemeProvider>
  );
}
