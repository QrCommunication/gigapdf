"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /protect — Encrypt a PDF with a password (AES).
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function ProtectPdfPage() {
  return <ToolPageShell toolKey="protect" />;
}
