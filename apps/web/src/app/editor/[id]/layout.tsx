"use client";

import { AuthGuard } from "@/components/auth/auth-guard";

export default function EditorLayout(props: { children?: React.ReactNode }) {
  return <AuthGuard>{props.children}</AuthGuard>;
}
