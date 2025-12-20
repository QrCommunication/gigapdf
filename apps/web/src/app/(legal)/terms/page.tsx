"use client";

import { useTranslations } from "next-intl";

export default function TermsPage() {
  const t = useTranslations("legal.terms");

  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-4xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">{t("lastUpdated")}: 20 décembre 2025</p>

      {/* Introduction */}
      <section className="mb-8">
        <h2>{t("intro.title")}</h2>
        <p>{t("intro.description")}</p>
      </section>

      {/* Definitions */}
      <section className="mb-8">
        <h2>{t("definitions.title")}</h2>
        <ul>
          <li><strong>&quot;Service&quot;</strong>: {t("definitions.service")}</li>
          <li><strong>&quot;Utilisateur&quot;</strong>: {t("definitions.user")}</li>
          <li><strong>&quot;Contenu&quot;</strong>: {t("definitions.content")}</li>
          <li><strong>&quot;Éditeur&quot;</strong>: {t("definitions.publisher")}</li>
        </ul>
      </section>

      {/* Publisher */}
      <section className="mb-8">
        <h2>{t("publisher.title")}</h2>
        <div className="rounded-lg border p-4 not-prose">
          <p><strong>Rony Licha</strong></p>
          <p>Développeur indépendant</p>
          <p>Paris, France</p>
          <p>Email: <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">rony@ronylicha.net</a></p>
          <p>Site: <a href="https://ronylicha.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ronylicha.net</a></p>
        </div>
        <h3>{t("publisher.hosting")}</h3>
        <div className="rounded-lg border p-4 not-prose">
          <p><strong>Scaleway SAS</strong></p>
          <p>8 rue de la Ville l'Évêque</p>
          <p>75008 Paris, France</p>
          <p>Site: <a href="https://www.scaleway.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.scaleway.com</a></p>
        </div>
      </section>

      {/* Acceptance */}
      <section className="mb-8">
        <h2>{t("acceptance.title")}</h2>
        <p>{t("acceptance.description")}</p>
      </section>

      {/* Service Description */}
      <section className="mb-8">
        <h2>{t("service.title")}</h2>
        <p>{t("service.description")}</p>
        <ul>
          <li>{t("service.features.edit")}</li>
          <li>{t("service.features.convert")}</li>
          <li>{t("service.features.storage")}</li>
          <li>{t("service.features.share")}</li>
          <li>{t("service.features.api")}</li>
        </ul>
      </section>

      {/* Account */}
      <section className="mb-8">
        <h2>{t("account.title")}</h2>
        <p>{t("account.description")}</p>
        <ul>
          <li>{t("account.obligations.accurate")}</li>
          <li>{t("account.obligations.secure")}</li>
          <li>{t("account.obligations.notify")}</li>
          <li>{t("account.obligations.responsible")}</li>
        </ul>
      </section>

      {/* Usage */}
      <section className="mb-8">
        <h2>{t("usage.title")}</h2>
        <p>{t("usage.description")}</p>
        <h3>{t("usage.prohibited.title")}</h3>
        <ul>
          <li>{t("usage.prohibited.illegal")}</li>
          <li>{t("usage.prohibited.harmful")}</li>
          <li>{t("usage.prohibited.infringing")}</li>
          <li>{t("usage.prohibited.malware")}</li>
          <li>{t("usage.prohibited.abuse")}</li>
          <li>{t("usage.prohibited.reverse")}</li>
        </ul>
      </section>

      {/* Content */}
      <section className="mb-8">
        <h2>{t("content.title")}</h2>
        <p>{t("content.ownership")}</p>
        <p>{t("content.license")}</p>
        <p>{t("content.responsibility")}</p>
      </section>

      {/* Open Source */}
      <section className="mb-8">
        <h2>{t("openSource.title")}</h2>
        <p>{t("openSource.description")}</p>
        <ul>
          <li>{t("openSource.license")}</li>
          <li>{t("openSource.source")}</li>
          <li>{t("openSource.contributions")}</li>
        </ul>
      </section>

      {/* Pricing */}
      <section className="mb-8">
        <h2>{t("pricing.title")}</h2>
        <p>{t("pricing.description")}</p>
        <ul>
          <li>{t("pricing.free")}</li>
          <li>{t("pricing.paid")}</li>
          <li>{t("pricing.renewal")}</li>
          <li>{t("pricing.cancellation")}</li>
        </ul>
      </section>

      {/* Limitation */}
      <section className="mb-8">
        <h2>{t("limitation.title")}</h2>
        <p>{t("limitation.description")}</p>
        <ul>
          <li>{t("limitation.availability")}</li>
          <li>{t("limitation.indirect")}</li>
          <li>{t("limitation.force")}</li>
        </ul>
      </section>

      {/* Warranty */}
      <section className="mb-8">
        <h2>{t("warranty.title")}</h2>
        <p>{t("warranty.description")}</p>
      </section>

      {/* Termination */}
      <section className="mb-8">
        <h2>{t("termination.title")}</h2>
        <p>{t("termination.byUser")}</p>
        <p>{t("termination.byUs")}</p>
        <p>{t("termination.effect")}</p>
      </section>

      {/* Modifications */}
      <section className="mb-8">
        <h2>{t("modifications.title")}</h2>
        <p>{t("modifications.description")}</p>
      </section>

      {/* Governing Law */}
      <section className="mb-8">
        <h2>{t("law.title")}</h2>
        <p>{t("law.description")}</p>
        <p>{t("law.jurisdiction")}</p>
      </section>

      {/* Contact */}
      <section className="mb-8">
        <h2>{t("contact.title")}</h2>
        <p>{t("contact.description")}</p>
        <div className="rounded-lg border p-4 not-prose">
          <p>Email: <a href="mailto:legal@giga-pdf.com" className="text-primary hover:underline">legal@giga-pdf.com</a></p>
          <p>Adresse: Paris, France</p>
        </div>
      </section>
    </div>
  );
}
