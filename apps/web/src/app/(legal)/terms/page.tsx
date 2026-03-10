"use client";

import { useTranslations } from "next-intl";
import { FileText, Scale, ShieldCheck, CreditCard, AlertTriangle, Gavel, Code2, Mail, Server, Ban } from "lucide-react";

export default function TermsPage() {
  const t = useTranslations("legal.terms");

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-4 py-1.5 text-sm mb-6">
          <FileText className="h-4 w-4 text-accent" />
          <span className="font-mono text-accent">terms-of-service</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2025-12-20
        </p>
      </div>

      {/* Introduction */}
      <section className="mb-12">
        <h2>{t("intro.title")}</h2>
        <p>{t("intro.description")}</p>
      </section>

      {/* Definitions */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("definitions.title")}</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-2">
          <p><span className="text-terminal-cyan">Service</span> = {t("definitions.service")}</p>
          <p><span className="text-terminal-green">Utilisateur</span> = {t("definitions.user")}</p>
          <p><span className="text-terminal-amber">Contenu</span> = {t("definitions.content")}</p>
          <p><span className="text-terminal-purple">Éditeur</span> = {t("definitions.publisher")}</p>
        </div>
      </section>

      {/* Publisher */}
      <section className="mb-12">
        <h2>{t("publisher.title")}</h2>
        <div className="grid gap-4 md:grid-cols-2 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-6 font-mono text-sm space-y-1">
            <p className="text-muted-foreground mb-2"># Publisher</p>
            <p><span className="text-terminal-cyan">name:</span> "Rony Licha"</p>
            <p><span className="text-terminal-cyan">role:</span> "Independent Developer"</p>
            <p><span className="text-terminal-cyan">location:</span> "Paris, France"</p>
            <p><span className="text-terminal-cyan">email:</span> <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">"rony@ronylicha.net"</a></p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-6 font-mono text-sm space-y-1">
            <p className="text-muted-foreground mb-2"># {t("publisher.hosting")}</p>
            <p><span className="text-terminal-cyan">provider:</span> "Scaleway SAS"</p>
            <p><span className="text-terminal-cyan">address:</span> "8 rue de la Ville l'Évêque"</p>
            <p><span className="text-terminal-cyan">city:</span> "75008 Paris, France"</p>
            <p><span className="text-terminal-cyan">website:</span> <a href="https://www.scaleway.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">"scaleway.com"</a></p>
          </div>
        </div>
      </section>

      {/* Acceptance */}
      <section className="mb-12">
        <h2>{t("acceptance.title")}</h2>
        <p>{t("acceptance.description")}</p>
      </section>

      {/* Service Description */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Server className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("service.title")}</h2>
        </div>
        <p>{t("service.description")}</p>
        <div className="grid gap-3 not-prose mt-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-green font-mono">01</span>
            <span>{t("service.features.edit")}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-cyan font-mono">02</span>
            <span>{t("service.features.convert")}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-amber font-mono">03</span>
            <span>{t("service.features.storage")}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-terminal-purple font-mono">04</span>
            <span>{t("service.features.share")}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
            <span className="text-primary font-mono">05</span>
            <span>{t("service.features.api")}</span>
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-amber/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-terminal-amber" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("account.title")}</h2>
        </div>
        <p>{t("account.description")}</p>
        <ul>
          <li>{t("account.obligations.accurate")}</li>
          <li>{t("account.obligations.secure")}</li>
          <li>{t("account.obligations.notify")}</li>
          <li>{t("account.obligations.responsible")}</li>
        </ul>
      </section>

      {/* Usage */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
            <Ban className="h-5 w-5 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("usage.title")}</h2>
        </div>
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
      <section className="mb-12">
        <h2>{t("content.title")}</h2>
        <p>{t("content.ownership")}</p>
        <p>{t("content.license")}</p>
        <p>{t("content.responsibility")}</p>
      </section>

      {/* Open Source */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-green/10 flex items-center justify-center">
            <Code2 className="h-5 w-5 text-terminal-green" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("openSource.title")}</h2>
        </div>
        <p>{t("openSource.description")}</p>
        <ul>
          <li>{t("openSource.license")}</li>
          <li>{t("openSource.source")}</li>
          <li>{t("openSource.contributions")}</li>
        </ul>
      </section>

      {/* Pricing */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-cyan/10 flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-terminal-cyan" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("pricing.title")}</h2>
        </div>
        <p>{t("pricing.description")}</p>
        <ul>
          <li>{t("pricing.free")}</li>
          <li>{t("pricing.paid")}</li>
          <li>{t("pricing.renewal")}</li>
          <li>{t("pricing.cancellation")}</li>
        </ul>
      </section>

      {/* Limitation */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-amber/10 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-terminal-amber" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("limitation.title")}</h2>
        </div>
        <p>{t("limitation.description")}</p>
        <ul>
          <li>{t("limitation.availability")}</li>
          <li>{t("limitation.indirect")}</li>
          <li>{t("limitation.force")}</li>
        </ul>
      </section>

      {/* Warranty */}
      <section className="mb-12">
        <h2>{t("warranty.title")}</h2>
        <p>{t("warranty.description")}</p>
      </section>

      {/* Termination */}
      <section className="mb-12">
        <h2>{t("termination.title")}</h2>
        <p>{t("termination.byUser")}</p>
        <p>{t("termination.byUs")}</p>
        <p>{t("termination.effect")}</p>
      </section>

      {/* Modifications */}
      <section className="mb-12">
        <h2>{t("modifications.title")}</h2>
        <p>{t("modifications.description")}</p>
      </section>

      {/* Governing Law */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-terminal-purple/10 flex items-center justify-center">
            <Gavel className="h-5 w-5 text-terminal-purple" />
          </div>
          <h2 className="text-2xl font-bold m-0">{t("law.title")}</h2>
        </div>
        <p>{t("law.description")}</p>
        <p>{t("law.jurisdiction")}</p>
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
            <p><span className="text-terminal-cyan">email:</span> <a href="mailto:legal@giga-pdf.com" className="text-primary hover:underline">"legal@giga-pdf.com"</a></p>
            <p><span className="text-terminal-cyan">location:</span> "Paris, France"</p>
          </div>
        </div>
      </section>
    </div>
  );
}
