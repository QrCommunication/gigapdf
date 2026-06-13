"use client";

import { useTranslations } from "next-intl";
import { Building2, Code2, Globe, Heart, Mail, MapPin, Phone, Users } from "lucide-react";
import Link from "next/link";
import { env } from "@/lib/env";

export default function AboutPage() {
  const t = useTranslations("legal.about");

  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-4xl font-bold mb-8">{t("title")}</h1>

      {/* Mission */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-primary/10 p-2">
            <Heart className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold m-0">{t("mission.title")}</h2>
        </div>
        <p className="text-muted-foreground text-lg">
          {t("mission.description")}
        </p>
      </section>

      {/* Open Source */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-primary/10 p-2">
            <Code2 className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold m-0">{t("openSource.title")}</h2>
        </div>
        <p className="text-muted-foreground">
          {t("openSource.description")}
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li>{t("openSource.features.transparent")}</li>
          <li>{t("openSource.features.selfHost")}</li>
          <li>{t("openSource.features.contribute")}</li>
          <li>{t("openSource.features.mitLicense")}</li>
        </ul>
      </section>

      {/* Company */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-primary/10 p-2">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold m-0">{t("company.title")}</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border p-6">
            <h3 className="font-semibold mb-4">{t("company.developer.title")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("company.developer.description")}
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>{env.NEXT_PUBLIC_LEGAL_COMPANY_NAME} {env.NEXT_PUBLIC_LEGAL_COMPANY_FORM} — SIREN {env.NEXT_PUBLIC_LEGAL_SIREN}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{env.NEXT_PUBLIC_LEGAL_ADDRESS}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <a href="https://github.com/QrCommunication/gigapdf" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  github.com/QrCommunication/gigapdf
                </a>
              </div>
            </div>
          </div>
          <div className="rounded-lg border p-6">
            <h3 className="font-semibold mb-4">{t("company.hosting.title")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("company.hosting.description")}
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p><strong>Scaleway SAS</strong></p>
              <p>8 rue de la Ville l'Évêque</p>
              <p>75008 Paris, France</p>
              <a href="https://www.scaleway.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                www.scaleway.com
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-primary/10 p-2">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold m-0">{t("contact.title")}</h2>
        </div>
        <div className="rounded-lg border p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{t("contact.email")}</p>
                <a href="mailto:contact@giga-pdf.com" className="text-primary hover:underline">
                  contact@giga-pdf.com
                </a>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{t("contact.phone")}</p>
                <a href="tel:+33767987176" className="text-primary hover:underline">
                  +33 7 67 98 71 76
                </a>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <Link href="/contact" className="text-primary hover:underline">
              {t("contact.formLink")} →
            </Link>
          </div>
        </div>
      </section>

      {/* Last updated */}
      <p className="text-sm text-muted-foreground text-center mt-12">
        {t("lastUpdated")}: 20 décembre 2025
      </p>
    </div>
  );
}
