import 'server-only';

/**
 * Builds a safe Content-Disposition header value following RFC 6266 / RFC 5987.
 *
 * Security: raw filenames supplied by users can contain CR/LF characters that
 * allow HTTP header injection (e.g. `evil\r\nX-Injected: yes`). This helper
 * removes all ASCII control characters before embedding the value in a header.
 *
 * Two filename parameters are emitted:
 *   - filename=    ASCII-safe fallback for legacy user-agents (RFC 6266 §4.3)
 *   - filename*=   RFC 5987 percent-encoded UTF-8 value for modern user-agents
 *
 * @param filename    The original filename (may contain non-ASCII or control chars)
 * @param disposition "attachment" (default) or "inline"
 * @returns           A complete Content-Disposition header value, e.g.:
 *                    `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
 */
export function sanitizeContentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  // Step 1: strip ASCII control characters (0x00-0x1F, 0x7F) and the two
  // characters that are unsafe inside a quoted-string (backslash, double-quote).
  // These are the vectors for header injection and RFC non-compliance.
  const cleaned = filename.replace(/[\x00-\x1f\x7f"\\]/g, '_');

  // Step 2: ASCII-only fallback — strip non-ASCII bytes so the value is safe
  // inside a legacy `filename="..."` parameter (RFC 6266 §4).
  const asciiFallback = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'download';

  // Step 3: RFC 5987 percent-encoded UTF-8 value for the `filename*=` parameter.
  // encodeURIComponent handles non-ASCII characters; control chars are already gone.
  const utf8Encoded = encodeURIComponent(cleaned);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}
