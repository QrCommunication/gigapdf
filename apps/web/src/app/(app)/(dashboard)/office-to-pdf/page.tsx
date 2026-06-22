"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /office-to-pdf — Convert Word, Excel, PowerPoint or OpenDocument to PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function OfficeToPdfPage() {
  return <ToolPageShell toolKey="office-to-pdf" />;
}
