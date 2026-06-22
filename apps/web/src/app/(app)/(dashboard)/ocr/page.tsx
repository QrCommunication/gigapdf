"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /ocr — Make a scanned PDF searchable via OCR.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function OcrPdfPage() {
  return <ToolPageShell toolKey="ocr" />;
}
