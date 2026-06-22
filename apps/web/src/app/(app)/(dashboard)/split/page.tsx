"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /split — Split a PDF into parts by page ranges.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function SplitPdfPage() {
  return <ToolPageShell toolKey="split" />;
}
