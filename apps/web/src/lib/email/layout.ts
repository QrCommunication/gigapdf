/**
 * GigaPDF — Email design system (charte graphique).
 *
 * Single source of truth for the visual identity of every transactional email.
 * Email clients are stuck in ~2005 HTML: no flexbox, no <style> reliability in
 * Gmail, no oklch(), no external CSS. So everything here is table-based layout
 * with inline styles and hex colours converted from the app's oklch tokens.
 *
 * Brand identity (mirrors apps/web/src/styles/globals.css + the logo SVGs):
 *   - Primary  : green  #16C088  (logo accent / --primary)
 *   - Accent   : cyan   #22D3EE  (--accent)
 *   - Dark     : #0A0E16 / #14181F (terminal background, used in the header)
 */

// Absolute, production-hosted base URL for assets + links inside emails.
// MUST NOT fall back to NEXT_PUBLIC_APP_URL: that variable is inlined at build
// time and is "localhost" in dev/CI bundles, which would break the logo and
// every footer link in real emails. Default to the marketing domain.
const EMAIL_BASE_URL = (process.env.EMAIL_BASE_URL || "https://giga-pdf.com").replace(/\/$/, "");

export const BRAND = {
  name: "GigaPDF",
  baseUrl: EMAIL_BASE_URL,
  // White logo variant, hosted absolutely — sits on the dark header.
  logoUrl: `${EMAIL_BASE_URL}/logo-horizontal-dark.png`,
  supportEmail: "support@giga-pdf.com",
  colors: {
    headerBg: "#0A0E16",
    bodyBg: "#0F172A0D", // unused fallback; real page bg below
    pageBg: "#EEF2F6",
    cardBg: "#FFFFFF",
    border: "#E2E8F0",
    heading: "#0F172A",
    text: "#334155",
    muted: "#64748B",
    primary: "#16C088",
    primaryDark: "#0E9E6E",
    accent: "#22D3EE",
    accentDark: "#0E9DB8",
  },
} as const;

export interface EmailCta {
  label: string;
  url: string;
  /** primary = green (default), accent = cyan. */
  variant?: "primary" | "accent";
}

export interface EmailLayoutOptions {
  locale?: string;
  /** Hidden preheader text shown in the inbox preview line. */
  preview?: string;
  /** Small label displayed under the logo in the header. */
  subtitle?: string;
  /** Main H2 heading inside the card. */
  heading: string;
  /** Trusted inner HTML (paragraphs/lists built by our own templates). */
  bodyHtml: string;
  cta?: EmailCta;
  /** Extra muted note rendered below the body / CTA. */
  footerNote?: string;
}

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', Arial, sans-serif";

function renderCta(cta: EmailCta): string {
  const c = BRAND.colors;
  const [start, end] =
    cta.variant === "accent" ? [c.accent, c.accentDark] : [c.primary, c.primaryDark];

  return `
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 32px auto 8px;">
              <tr>
                <td style="border-radius: 10px; background: linear-gradient(135deg, ${start} 0%, ${end} 100%);">
                  <a href="${cta.url}" target="_blank" rel="noopener noreferrer"
                     style="display: inline-block; padding: 15px 36px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 700; letter-spacing: 0.2px;">
                    ${cta.label}
                  </a>
                </td>
              </tr>
            </table>`;
}

/**
 * Wraps trusted body HTML in the shared GigaPDF brand shell.
 * Returns a complete, standalone HTML document ready to send.
 */
export function renderEmail(options: EmailLayoutOptions): string {
  const { locale = "fr", preview, subtitle, heading, bodyHtml, cta, footerNote } = options;
  const c = BRAND.colors;
  const isEnglish = locale === "en";
  const year = new Date().getFullYear();

  const footerHelp = isEnglish
    ? `Questions? Contact us at <a href="mailto:${BRAND.supportEmail}" style="color: ${c.primary}; text-decoration: none;">${BRAND.supportEmail}</a>`
    : `Une question ? Écrivez-nous à <a href="mailto:${BRAND.supportEmail}" style="color: ${c.primary}; text-decoration: none;">${BRAND.supportEmail}</a>`;

  const rights = isEnglish ? "All rights reserved." : "Tous droits réservés.";
  const tagline = isEnglish ? "Professional PDF Editor" : "Éditeur PDF professionnel";

  return `<!DOCTYPE html>
<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${heading}</title>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: ${c.pageBg}; font-family: ${fontStack};">
  ${
    preview
      ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${preview}</div>`
      : ""
  }
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${c.pageBg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: ${c.cardBg}; border: 1px solid ${c.border}; border-radius: 16px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td align="center" style="background-color: ${c.headerBg}; padding: 36px 30px 32px;">
              <a href="${BRAND.baseUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">
                <img src="${BRAND.logoUrl}" alt="${BRAND.name}" width="180" height="48"
                     style="display: block; border: 0; outline: none; height: 48px; width: auto;" />
              </a>
              <p style="margin: 14px 0 0; color: #94A3B8; font-size: 13px; letter-spacing: 0.4px;">
                ${subtitle || tagline}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 36px 32px;">
              <h1 style="margin: 0 0 22px; color: ${c.heading}; font-size: 23px; line-height: 1.3; font-weight: 700;">
                ${heading}
              </h1>
              <div style="color: ${c.text}; font-size: 16px; line-height: 1.65;">
                ${bodyHtml}
              </div>
              ${cta ? renderCta(cta) : ""}
              ${
                footerNote
                  ? `<p style="margin: 28px 0 0; color: ${c.muted}; font-size: 13px; line-height: 1.6;">${footerNote}</p>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; border-top: 1px solid ${c.border}; padding: 28px 36px; text-align: center;">
              <p style="margin: 0 0 8px; color: ${c.muted}; font-size: 13px; line-height: 1.6;">
                ${footerHelp}
              </p>
              <p style="margin: 0; color: #94A3B8; font-size: 12px;">
                © ${year} ${BRAND.name}. ${rights}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
