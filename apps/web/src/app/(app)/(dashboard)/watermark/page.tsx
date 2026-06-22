"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /watermark — Stamp a text watermark across a PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function WatermarkPdfPage() {
  return <ToolPageShell toolKey="watermark" />;
}
