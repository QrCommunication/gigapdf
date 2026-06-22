"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-excel — Extract a PDF's text into an Excel (.xlsx) spreadsheet.
 * Uploads the file for a session id, then exports via /api/office/export.
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToExcelPage() {
  return <ToolPageShell toolKey="pdf-to-excel" />;
}
