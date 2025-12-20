"use client";

import { useTranslations } from "next-intl";

export default function PrivacyPage() {
  const t = useTranslations("legal.privacy");

  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-4xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">{t("lastUpdated")}: 20 décembre 2025</p>

      {/* Introduction */}
      <section className="mb-8">
        <h2>{t("intro.title")}</h2>
        <p>{t("intro.description")}</p>
      </section>

      {/* Data Controller */}
      <section className="mb-8">
        <h2>{t("controller.title")}</h2>
        <div className="rounded-lg border p-4 not-prose">
          <p><strong>Rony Licha</strong></p>
          <p>Développeur indépendant</p>
          <p>Paris, France</p>
          <p>Email: <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">rony@ronylicha.net</a></p>
          <p>Site: <a href="https://ronylicha.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ronylicha.net</a></p>
        </div>
      </section>

      {/* Data Collected */}
      <section className="mb-8">
        <h2>{t("dataCollected.title")}</h2>
        <h3>{t("dataCollected.account.title")}</h3>
        <ul>
          <li>{t("dataCollected.account.email")}</li>
          <li>{t("dataCollected.account.name")}</li>
          <li>{t("dataCollected.account.password")}</li>
        </ul>
        <h3>{t("dataCollected.usage.title")}</h3>
        <ul>
          <li>{t("dataCollected.usage.documents")}</li>
          <li>{t("dataCollected.usage.logs")}</li>
          <li>{t("dataCollected.usage.analytics")}</li>
        </ul>
        <h3>{t("dataCollected.technical.title")}</h3>
        <ul>
          <li>{t("dataCollected.technical.ip")}</li>
          <li>{t("dataCollected.technical.browser")}</li>
          <li>{t("dataCollected.technical.device")}</li>
        </ul>
      </section>

      {/* Purpose */}
      <section className="mb-8">
        <h2>{t("purpose.title")}</h2>
        <ul>
          <li>{t("purpose.service")}</li>
          <li>{t("purpose.security")}</li>
          <li>{t("purpose.improvement")}</li>
          <li>{t("purpose.communication")}</li>
          <li>{t("purpose.legal")}</li>
        </ul>
      </section>

      {/* Legal Basis */}
      <section className="mb-8">
        <h2>{t("legalBasis.title")}</h2>
        <ul>
          <li><strong>{t("legalBasis.contract.title")}:</strong> {t("legalBasis.contract.description")}</li>
          <li><strong>{t("legalBasis.consent.title")}:</strong> {t("legalBasis.consent.description")}</li>
          <li><strong>{t("legalBasis.legitimate.title")}:</strong> {t("legalBasis.legitimate.description")}</li>
          <li><strong>{t("legalBasis.legal.title")}:</strong> {t("legalBasis.legal.description")}</li>
        </ul>
      </section>

      {/* Data Retention */}
      <section className="mb-8">
        <h2>{t("retention.title")}</h2>
        <p>{t("retention.description")}</p>
        <ul>
          <li>{t("retention.account")}</li>
          <li>{t("retention.documents")}</li>
          <li>{t("retention.logs")}</li>
        </ul>
      </section>

      {/* Data Sharing */}
      <section className="mb-8">
        <h2>{t("sharing.title")}</h2>
        <p>{t("sharing.description")}</p>
        <h3>{t("sharing.providers.title")}</h3>
        <ul>
          <li><strong>Scaleway SAS</strong> - {t("sharing.providers.hosting")}</li>
          <li><strong>Stripe</strong> - {t("sharing.providers.payment")}</li>
        </ul>
      </section>

      {/* Your Rights */}
      <section className="mb-8">
        <h2>{t("rights.title")}</h2>
        <p>{t("rights.description")}</p>
        <ul>
          <li><strong>{t("rights.access.title")}:</strong> {t("rights.access.description")}</li>
          <li><strong>{t("rights.rectification.title")}:</strong> {t("rights.rectification.description")}</li>
          <li><strong>{t("rights.erasure.title")}:</strong> {t("rights.erasure.description")}</li>
          <li><strong>{t("rights.portability.title")}:</strong> {t("rights.portability.description")}</li>
          <li><strong>{t("rights.objection.title")}:</strong> {t("rights.objection.description")}</li>
          <li><strong>{t("rights.restriction.title")}:</strong> {t("rights.restriction.description")}</li>
        </ul>
        <p>{t("rights.exercise")}: <a href="mailto:privacy@giga-pdf.com" className="text-primary hover:underline">privacy@giga-pdf.com</a></p>
      </section>

      {/* Cookies */}
      <section className="mb-8">
        <h2>{t("cookies.title")}</h2>
        <p>{t("cookies.description")}</p>
        <ul>
          <li><strong>{t("cookies.essential.title")}:</strong> {t("cookies.essential.description")}</li>
          <li><strong>{t("cookies.functional.title")}:</strong> {t("cookies.functional.description")}</li>
        </ul>
      </section>

      {/* Security */}
      <section className="mb-8">
        <h2>{t("security.title")}</h2>
        <p>{t("security.description")}</p>
        <ul>
          <li>{t("security.encryption")}</li>
          <li>{t("security.access")}</li>
          <li>{t("security.monitoring")}</li>
        </ul>
      </section>

      {/* Open Source */}
      <section className="mb-8">
        <h2>{t("openSource.title")}</h2>
        <p>{t("openSource.description")}</p>
      </section>

      {/* Changes */}
      <section className="mb-8">
        <h2>{t("changes.title")}</h2>
        <p>{t("changes.description")}</p>
      </section>

      {/* Contact */}
      <section className="mb-8">
        <h2>{t("contact.title")}</h2>
        <p>{t("contact.description")}</p>
        <div className="rounded-lg border p-4 not-prose">
          <p>Email: <a href="mailto:privacy@giga-pdf.com" className="text-primary hover:underline">privacy@giga-pdf.com</a></p>
          <p>Adresse: Paris, France</p>
        </div>
        <p className="mt-4">{t("contact.cnil")}: <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.cnil.fr</a></p>
      </section>
    </div>
  );
}
