"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-powerpoint — Convert a PDF to a PowerPoint (.pptx) presentation.
 * Uploads the file for a session id, then exports via /api/office/export.
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToPowerpointPage() {
  return <ToolPageShell toolKey="pdf-to-powerpoint" />;
}
