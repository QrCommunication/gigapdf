"use client";

import { useTranslations } from "next-intl";
import { Shield, Database, Lock, Eye, Cookie, Bell, Code2, Mail, Scale } from "lucide-react";

export default function PrivacyPage() {
  const t = useTranslations("legal.privacy");

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-6">
          <Shield className="h-4 w-4 text-primary" />
          <span className="font-mono text-primary">privacy-policy</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2025-12-20
        </p>
      </div>

      {/* Introduction */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Eye className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("intro.title")}</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">{t("intro.description")}</p>
      </section>

      {/* Data Controller */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("controller.title")}</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">name:</span> "Rony Licha"</p>
          <p><span className="text-terminal-cyan">role:</span> "Independent Developer"</p>
          <p><span className="text-terminal-cyan">location:</span> "Paris, France"</p>
          <p><span className="text-terminal-cyan">email:</span> <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">"rony@ronylicha.net"</a></p>
          <p><span className="text-terminal-cyan">website:</span> <a href="https://ronylicha.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">"ronylicha.net"</a></p>
        </div>
      </section>

      {/* Data Collected */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-amber/10 flex items-center justify-center">
            <Database className="h-5 w-5 text-terminal-amber" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("dataCollected.title")}</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-3">{t("dataCollected.account.title")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><span className="text-terminal-green">-</span> {t("dataCollected.account.email")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-green">-</span> {t("dataCollected.account.name")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-green">-</span> {t("dataCollected.account.password")}</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-3">{t("dataCollected.usage.title")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><span className="text-terminal-cyan">-</span> {t("dataCollected.usage.documents")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-cyan">-</span> {t("dataCollected.usage.logs")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-cyan">-</span> {t("dataCollected.usage.analytics")}</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-3">{t("dataCollected.technical.title")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><span className="text-terminal-purple">-</span> {t("dataCollected.technical.ip")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-purple">-</span> {t("dataCollected.technical.browser")}</li>
              <li className="flex items-center gap-2"><span className="text-terminal-purple">-</span> {t("dataCollected.technical.device")}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Purpose */}
      <section className="mb-12">
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
      <section className="mb-12">
        <h2>{t("legalBasis.title")}</h2>
        <div className="grid gap-4 md:grid-cols-2 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold text-primary mb-2">{t("legalBasis.contract.title")}</h4>
            <p className="text-sm text-muted-foreground">{t("legalBasis.contract.description")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold text-accent mb-2">{t("legalBasis.consent.title")}</h4>
            <p className="text-sm text-muted-foreground">{t("legalBasis.consent.description")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold text-terminal-amber mb-2">{t("legalBasis.legitimate.title")}</h4>
            <p className="text-sm text-muted-foreground">{t("legalBasis.legitimate.description")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold text-terminal-purple mb-2">{t("legalBasis.legal.title")}</h4>
            <p className="text-sm text-muted-foreground">{t("legalBasis.legal.description")}</p>
          </div>
        </div>
      </section>

      {/* Data Retention */}
      <section className="mb-12">
        <h2>{t("retention.title")}</h2>
        <p>{t("retention.description")}</p>
        <ul>
          <li>{t("retention.account")}</li>
          <li>{t("retention.documents")}</li>
          <li>{t("retention.logs")}</li>
        </ul>
      </section>

      {/* Data Sharing */}
      <section className="mb-12">
        <h2>{t("sharing.title")}</h2>
        <p>{t("sharing.description")}</p>
        <h3>{t("sharing.providers.title")}</h3>
        <div className="grid gap-4 md:grid-cols-2 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold mb-1">Scaleway SAS</h4>
            <p className="text-sm text-muted-foreground">{t("sharing.providers.hosting")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <h4 className="font-semibold mb-1">Stripe</h4>
            <p className="text-sm text-muted-foreground">{t("sharing.providers.payment")}</p>
          </div>
        </div>
      </section>

      {/* Your Rights */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-green/10 flex items-center justify-center">
            <Lock className="h-5 w-5 text-terminal-green" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("rights.title")}</h2>
        </div>
        <p>{t("rights.description")}</p>
        <div className="grid gap-3 not-prose mt-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-green font-mono text-sm">01</span>
            <div>
              <h4 className="font-semibold">{t("rights.access.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("rights.access.description")}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-cyan font-mono text-sm">02</span>
            <div>
              <h4 className="font-semibold">{t("rights.rectification.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("rights.rectification.description")}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-amber font-mono text-sm">03</span>
            <div>
              <h4 className="font-semibold">{t("rights.erasure.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("rights.erasure.description")}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-purple font-mono text-sm">04</span>
            <div>
              <h4 className="font-semibold">{t("rights.portability.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("rights.portability.description")}</p>
            </div>
          </div>
        </div>
        <p className="mt-4">{t("rights.exercise")}: <a href="mailto:privacy@giga-pdf.com" className="text-primary hover:underline">privacy@giga-pdf.com</a></p>
      </section>

      {/* Cookies */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-cyan/10 flex items-center justify-center">
            <Cookie className="h-5 w-5 text-terminal-cyan" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("cookies.title")}</h2>
        </div>
        <p>{t("cookies.description")}</p>
        <ul>
          <li><strong>{t("cookies.essential.title")}:</strong> {t("cookies.essential.description")}</li>
          <li><strong>{t("cookies.functional.title")}:</strong> {t("cookies.functional.description")}</li>
        </ul>
      </section>

      {/* Security */}
      <section className="mb-12">
        <h2>{t("security.title")}</h2>
        <p>{t("security.description")}</p>
        <ul>
          <li>{t("security.encryption")}</li>
          <li>{t("security.access")}</li>
          <li>{t("security.monitoring")}</li>
        </ul>
      </section>

      {/* Open Source */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Code2 className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("openSource.title")}</h2>
        </div>
        <p>{t("openSource.description")}</p>
      </section>

      {/* Changes */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-amber/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-terminal-amber" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("changes.title")}</h2>
        </div>
        <p>{t("changes.description")}</p>
      </section>

      {/* Contact */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Mail className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("contact.title")}</h2>
        </div>
        <p>{t("contact.description")}</p>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose mt-4">
          <div className="font-mono text-sm space-y-1">
            <p><span className="text-terminal-cyan">email:</span> <a href="mailto:privacy@giga-pdf.com" className="text-primary hover:underline">"privacy@giga-pdf.com"</a></p>
            <p><span className="text-terminal-cyan">location:</span> "Paris, France"</p>
          </div>
        </div>
        <p className="mt-4">{t("contact.cnil")}: <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.cnil.fr</a></p>
      </section>
    </div>
  );
}
