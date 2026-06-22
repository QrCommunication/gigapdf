"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /sign — Apply a digital signature to a PDF with a PKCS#12 certificate.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function SignPdfPage() {
  return <ToolPageShell toolKey="sign" />;
}
