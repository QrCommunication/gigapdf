"use client";

import { AuthGuard } from "@/components/auth/auth-guard";

// Auth par cookies + document chargé au runtime → rendu dynamique obligatoire.
// Explicite depuis le retrait du force-dynamic global du root layout.
export const dynamic = "force-dynamic";

export default function EditorLayout(props: { children?: React.ReactNode }) {
  return <AuthGuard>{props.children}</AuthGuard>;
}
