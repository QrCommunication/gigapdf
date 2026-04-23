import nodemailer from "nodemailer";
import { serverLogger } from "@/lib/server-logger";

// Configuration from environment variables
const mailConfig = {
  host: process.env.MAIL_SERVER || "smtp.example.com",
  port: parseInt(process.env.MAIL_PORT || "587"),
  secure: process.env.MAIL_USE_SSL === "true", // true for 465, false for other ports
  auth: {
    user: process.env.MAIL_USERNAME || "",
    pass: process.env.MAIL_PASSWORD || "",
  },
};

const fromEmail = process.env.MAIL_FROM_EMAIL || "noreply@giga-pdf.com";
const fromName = process.env.MAIL_FROM_NAME || "GigaPDF";
const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Create transporter
const transporter = nodemailer.createTransport(mailConfig);

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<boolean> {
  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: text || html.replace(/<[^>]*>/g, ""),
      html,
    });

    serverLogger.info("email.sent", { messageId: info.messageId });
    return true;
  } catch (error) {
    serverLogger.error("email.send-failed", { error });
    return false;
  }
}

// Email templates
export function getWelcomeEmailTemplate(userName: string, locale: string = "fr"): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? `Welcome to GigaPDF, ${userName}!`
    : `Bienvenue sur GigaPDF, ${userName} !`;

  const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">GigaPDF</h1>
              <p style="margin: 10px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                ${isEnglish ? "Professional PDF Editor" : "Éditeur PDF Professionnel"}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #18181b; font-size: 24px; font-weight: 600;">
                ${isEnglish ? `Welcome, ${userName}!` : `Bienvenue, ${userName} !`}
              </h2>

              <p style="margin: 0 0 20px; color: #3f3f46; font-size: 16px; line-height: 1.6;">
                ${isEnglish
                  ? "Thank you for creating your GigaPDF account. You now have access to our powerful PDF editing tools."
                  : "Merci d'avoir créé votre compte GigaPDF. Vous avez maintenant accès à nos puissants outils d'édition PDF."
                }
              </p>

              <p style="margin: 0 0 30px; color: #3f3f46; font-size: 16px; line-height: 1.6;">
                ${isEnglish
                  ? "Here's what you can do with GigaPDF:"
                  : "Voici ce que vous pouvez faire avec GigaPDF :"
                }
              </p>

              <ul style="margin: 0 0 30px; padding-left: 20px; color: #3f3f46; font-size: 16px; line-height: 1.8;">
                <li>${isEnglish ? "Create and edit PDF documents" : "Créer et modifier des documents PDF"}</li>
                <li>${isEnglish ? "Collaborate in real-time" : "Collaborer en temps réel"}</li>
                <li>${isEnglish ? "Add signatures, annotations, and forms" : "Ajouter des signatures, annotations et formulaires"}</li>
                <li>${isEnglish ? "Convert documents to various formats" : "Convertir des documents en différents formats"}</li>
              </ul>

              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">
                    <a href="${frontendUrl}/dashboard" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      ${isEnglish ? "Go to Dashboard" : "Accéder au tableau de bord"}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 30px; text-align: center;">
              <p style="margin: 0 0 10px; color: #71717a; font-size: 14px;">
                ${isEnglish
                  ? "Questions? Contact us at support@giga-pdf.com"
                  : "Des questions ? Contactez-nous à support@giga-pdf.com"
                }
              </p>
              <p style="margin: 0; color: #a1a1aa; font-size: 12px;">
                © ${new Date().getFullYear()} GigaPDF. ${isEnglish ? "All rights reserved." : "Tous droits réservés."}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return { subject, html };
}

export function getPasswordResetEmailTemplate(resetUrl: string, locale: string = "fr"): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? "Reset your GigaPDF password"
    : "Réinitialiser votre mot de passe GigaPDF";

  const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">GigaPDF</h1>
              <p style="margin: 10px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                ${isEnglish ? "Password Reset" : "Réinitialisation du mot de passe"}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #18181b; font-size: 24px; font-weight: 600;">
                ${isEnglish ? "Reset your password" : "Réinitialiser votre mot de passe"}
              </h2>

              <p style="margin: 0 0 20px; color: #3f3f46; font-size: 16px; line-height: 1.6;">
                ${isEnglish
                  ? "We received a request to reset your password. Click the button below to create a new password."
                  : "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe."
                }
              </p>

              <table role="presentation" style="margin: 30px auto;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">
                    <a href="${resetUrl}" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      ${isEnglish ? "Reset Password" : "Réinitialiser le mot de passe"}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0; color: #71717a; font-size: 14px; line-height: 1.6;">
                ${isEnglish
                  ? "If you didn't request this password reset, you can safely ignore this email. The link will expire in 1 hour."
                  : "Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email en toute sécurité. Le lien expirera dans 1 heure."
                }
              </p>

              <p style="margin: 20px 0 0; color: #a1a1aa; font-size: 12px; word-break: break-all;">
                ${isEnglish ? "If the button doesn't work, copy this link:" : "Si le bouton ne fonctionne pas, copiez ce lien :"}<br>
                <a href="${resetUrl}" style="color: #3b82f6;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 30px; text-align: center;">
              <p style="margin: 0 0 10px; color: #71717a; font-size: 14px;">
                ${isEnglish
                  ? "Questions? Contact us at support@giga-pdf.com"
                  : "Des questions ? Contactez-nous à support@giga-pdf.com"
                }
              </p>
              <p style="margin: 0; color: #a1a1aa; font-size: 12px;">
                © ${new Date().getFullYear()} GigaPDF. ${isEnglish ? "All rights reserved." : "Tous droits réservés."}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return { subject, html };
}

export function getVerificationEmailTemplate(verificationUrl: string, locale: string = "fr"): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? "Verify your GigaPDF email"
    : "Vérifiez votre email GigaPDF";

  const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">GigaPDF</h1>
              <p style="margin: 10px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                ${isEnglish ? "Email Verification" : "Vérification de l'email"}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #18181b; font-size: 24px; font-weight: 600;">
                ${isEnglish ? "Verify your email address" : "Vérifiez votre adresse email"}
              </h2>

              <p style="margin: 0 0 20px; color: #3f3f46; font-size: 16px; line-height: 1.6;">
                ${isEnglish
                  ? "Please click the button below to verify your email address and complete your registration."
                  : "Veuillez cliquer sur le bouton ci-dessous pour vérifier votre adresse email et compléter votre inscription."
                }
              </p>

              <table role="presentation" style="margin: 30px auto;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                    <a href="${verificationUrl}" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                      ${isEnglish ? "Verify Email" : "Vérifier l'email"}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0; color: #71717a; font-size: 14px; line-height: 1.6;">
                ${isEnglish
                  ? "This link will expire in 24 hours."
                  : "Ce lien expirera dans 24 heures."
                }
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 30px; text-align: center;">
              <p style="margin: 0; color: #a1a1aa; font-size: 12px;">
                © ${new Date().getFullYear()} GigaPDF. ${isEnglish ? "All rights reserved." : "Tous droits réservés."}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return { subject, html };
}
