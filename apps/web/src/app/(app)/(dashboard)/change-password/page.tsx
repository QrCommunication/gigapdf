"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /change-password — Change or set the password protecting a PDF.
 *
 * Distinct from /unlock (which removes protection) and /protect (which encrypts
 * a plaintext PDF): this tool rotates an existing password (opening the file
 * with the current one) or sets a brand-new one. Auth + locale (cookie) are
 * handled by the parent (app)/(dashboard) layout. Thin shell over ToolRunner.
 */
export default function ChangePasswordPage() {
  return <ToolPageShell toolKey="change-password" />;
}
