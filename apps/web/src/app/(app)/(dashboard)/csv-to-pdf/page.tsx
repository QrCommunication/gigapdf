"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /csv-to-pdf — Convert a CSV (.csv) file to a PDF table. Posts the file to
 * /api/convert/text-format (engine csvToModel → modelToPdf). Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function CsvToPdfPage() {
  return <ToolPageShell toolKey="csv-to-pdf" />;
}
