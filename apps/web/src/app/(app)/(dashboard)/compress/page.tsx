"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /compress — Reduce the file size of a PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function CompressPdfPage() {
  return <ToolPageShell toolKey="compress" />;
}
