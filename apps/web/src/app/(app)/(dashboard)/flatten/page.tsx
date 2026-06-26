"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /flatten — Flatten form fields and/or annotations into static PDF content.
 *
 * After flattening, interactive elements become non-editable graphics: the
 * visual result is identical but the document is finalised for printing,
 * archiving or distribution. Auth + locale (cookie) are handled by the parent
 * (app)/(dashboard) layout. Thin shell over the generic ToolRunner.
 */
export default function FlattenPdfPage() {
  return <ToolPageShell toolKey="flatten" />;
}
