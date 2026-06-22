"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /text-to-pdf — Render plain text as a clean PDF via the in-house HTML→PDF
 * engine. Auth + locale (cookie) are handled by the parent (app)/(dashboard)
 * layout (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function TextToPdfPage() {
  return <ToolPageShell toolKey="text-to-pdf" />;
}
