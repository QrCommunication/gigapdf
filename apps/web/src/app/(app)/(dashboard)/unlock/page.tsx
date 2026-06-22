"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /unlock — Remove the password from an encrypted PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function UnlockPdfPage() {
  return <ToolPageShell toolKey="unlock" />;
}
