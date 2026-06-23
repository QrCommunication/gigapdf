"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-csv — Convert a PDF's tabular content to a CSV (.csv) file. Uploads
 * the file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToCsvPage() {
  return <ToolPageShell toolKey="pdf-to-csv" />;
}
