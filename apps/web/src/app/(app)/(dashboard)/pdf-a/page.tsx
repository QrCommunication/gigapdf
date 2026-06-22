"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-a — Convert a PDF to an archival PDF/A variant.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function PdfAPage() {
  return <ToolPageShell toolKey="pdf-a" />;
}
