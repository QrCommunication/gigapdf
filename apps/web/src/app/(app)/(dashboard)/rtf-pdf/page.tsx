"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /rtf-pdf — Convert a Rich Text Format (.rtf) file to PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner; the
 * "rtf-to-pdf" config posts to /api/office/upload, which renders RTF through
 * the engine's dedicated RTF parser (rtfToPdf).
 */
export default function RtfToPdfPage() {
  return <ToolPageShell toolKey="rtf-to-pdf" />;
}
