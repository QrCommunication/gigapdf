"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, cn } from "@giga-pdf/ui";
import {
  ArrowRight,
  Check,
  FileInput,
  Github,
  LayoutGrid,
  Lock,
  Mail,
  Scale,
  ScanText,
  Server,
  ShieldCheck,
  Signature,
  Users,
} from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { AnimCollaboration } from "@/components/landing/anim-collaboration";
import { AnimCompression } from "@/components/landing/anim-compression";
import { AnimFormats } from "@/components/landing/anim-formats";
import { AnimOcr } from "@/components/landing/anim-ocr";
import { AnimSignature } from "@/components/landing/anim-signature";
import { CropMarks } from "@/components/landing/crop-marks";
import { EditorMockup } from "@/components/landing/editor-mockup";
import { Reveal } from "@/components/landing/reveal";
import { ScrollRuler } from "@/components/landing/scroll-ruler";
import { SectionHeading } from "@/components/landing/section-heading";
import {
  VignetteCollaboration,
  VignetteEditing,
  VignetteFormats,
  VignetteGed,
  VignetteTrust,
} from "@/components/landing/section-vignettes";

const GITHUB_URL = "https://github.com/ronylicha/gigapdf";
const CONTACT_EMAIL = "contact@giga-pdf.com";

/** Les 5 sections numérotées du cahier (zigzag 2 colonnes alternées). */
const NOTEBOOK_SECTIONS = [
  { id: "features", number: "01", key: "editing", points: ["wysiwyg", "fonts", "formatting", "layers", "multiselect"] },
  { id: "collaboration", number: "02", key: "collaboration", points: ["live", "sharing", "versions", "activity"] },
  { id: "confiance", number: "03", key: "trust", points: ["signature", "encryption", "pdfa", "ocr"] },
  { id: "formats", number: "04", key: "formats", points: ["imports", "exports", "compression"] },
  { id: "ged", number: "05", key: "ged", points: ["folders", "tags", "search", "trash", "thumbnails"] },
] as const;

const INCLUDED_EVERYWHERE = [
  { key: "signature", icon: Signature },
  { key: "ocr", icon: ScanText },
  { key: "collaboration", icon: Users },
  { key: "tools", icon: LayoutGrid },
  { key: "office", icon: FileInput },
] as const;

export default function HomePage() {
  const t = useTranslations("landing");

  const trustItems = [
    { key: "openSource", icon: Scale },
    { key: "selfHost", icon: Server },
    { key: "encryption", icon: Lock },
    { key: "gdpr", icon: ShieldCheck },
  ] as const;

  const plans = [
    {
      id: "free",
      price: 0,
      popular: false,
      features: ["storage", "apiCalls", "documents", "editing", "support"],
    },
    {
      id: "starter",
      price: 9,
      popular: true,
      features: ["storage", "apiCalls", "documents", "members", "support", "trial"],
    },
    {
      id: "pro",
      price: 29,
      popular: false,
      features: ["storage", "apiCalls", "documents", "branding", "support", "api", "trial"],
    },
    {
      id: "enterprise",
      price: null,
      popular: false,
      features: ["storage", "apiCalls", "documents", "branding", "sla", "accountManager", "support", "integrations"],
    },
  ] as const;

  const sectionVignettes: Record<string, ReactNode> = {
    editing: <VignetteEditing />,
    collaboration: (
      <VignetteCollaboration versionLabel={t("sections.collaboration.versionsLabel")} />
    ),
    trust: <VignetteTrust stampText={t("sections.trust.stamp")} />,
    formats: <VignetteFormats />,
    ged: <VignetteGed searchPlaceholder={t("sections.ged.searchPlaceholder")} />,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ScrollRuler />
      <Header />

      <main className="flex-1">
        {/* ════════════════════════════════════════════════════════════════
            HERO — split asymétrique 55/45, texte gauche, épreuve à droite
            ════════════════════════════════════════════════════════════════ */}
        <section className="border-b border-border">
          <div className="container mx-auto flex min-h-[calc(100dvh-4rem)] items-center px-4 py-16 lg:py-20">
            <div className="grid w-full items-center gap-16 lg:grid-cols-[55fr_45fr] lg:gap-12">
              <Reveal>
                <div className="max-w-2xl">
                  <p className="lp-label mb-6 flex items-center gap-3">
                    <span aria-hidden="true" className="h-1.5 w-1.5 bg-primary" />
                    {t("hero.kicker")}
                  </p>
                  <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
                    {t("hero.title")}{" "}
                    <span className="text-primary">{t("hero.titleAccent")}</span>
                  </h1>
                  <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                    {t("hero.description")}
                  </p>
                  <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                    <Link href="/register">
                      <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                        {t("hero.ctaPrimary")}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                      <Button
                        size="lg"
                        variant="outline"
                        className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                      >
                        <Github className="h-4 w-4" />
                        {t("hero.ctaSecondary")}
                      </Button>
                    </a>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={100}>
                <div className="px-6 pt-6 lg:px-4">
                  <EditorMockup />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            BANDEAU CONFIANCE — AGPL · auto-hébergeable · AES-256 · RGPD
            ════════════════════════════════════════════════════════════════ */}
        <section id="open-source" aria-label={t("trust.label")} className="border-b border-border bg-muted/30">
          <div className="container mx-auto px-4 py-5">
            <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              {trustItems.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-center gap-2.5">
                  <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {t(`trust.${key}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            CAHIER 01 → 05 — sections zigzag 2 colonnes alternées
            ════════════════════════════════════════════════════════════════ */}
        {NOTEBOOK_SECTIONS.map(({ id, number, key, points }, index) => {
          const flip = index % 2 === 1;
          return (
            <section key={key} id={id} className="border-b border-border">
              <div className="container mx-auto grid items-center gap-12 px-4 py-20 md:py-28 lg:grid-cols-2 lg:gap-20">
                <Reveal className={flip ? "lg:order-2" : undefined}>
                  <SectionHeading
                    number={number}
                    label={t(`sections.${key}.label`)}
                    title={t(`sections.${key}.title`)}
                    description={t(`sections.${key}.description`)}
                  />
                  <ul className="mt-8 space-y-3.5">
                    {points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-3 text-sm leading-relaxed md:text-base"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-[0.6em] h-px w-4 shrink-0 bg-primary"
                        />
                        <span>{t(`sections.${key}.points.${point}`)}</span>
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal delay={100} className={cn("px-6", flip ? "lg:order-1" : undefined)}>
                  {sectionVignettes[key]}
                </Reveal>
              </div>
            </section>
          );
        })}

        {/* ════════════════════════════════════════════════════════════════
            BENTO — 5 capacités phares, grid asymétrique 2fr/1fr animée
            ════════════════════════════════════════════════════════════════ */}
        <section id="capabilities" className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <div className="mb-14 max-w-xl">
                <div className="mb-5 flex items-center gap-4">
                  <span aria-hidden="true" className="lp-rule w-10 shrink-0" />
                  <span className="lp-label">{t("bento.label")}</span>
                </div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                  {t("bento.title")}
                </h2>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
                  {t("bento.description")}
                </p>
              </div>
            </Reveal>

            <div className="relative">
              <CropMarks />
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                {/* Collaboration live — grande cellule */}
                <Reveal className="h-full lg:row-span-2">
                  <article className="flex h-full flex-col rounded-md border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-display text-lg font-semibold">
                      {t("bento.collaboration.title")}
                    </h3>
                    <p className="mb-5 mt-1.5 text-sm text-muted-foreground">
                      {t("bento.collaboration.description")}
                    </p>
                    <div className="flex-1">
                      <AnimCollaboration
                        labelA={t("bento.collaboration.you")}
                        labelB={t("bento.collaboration.guest")}
                      />
                    </div>
                  </article>
                </Reveal>

                {/* Signature PKCS#7 */}
                <Reveal delay={50} className="h-full">
                  <article className="flex h-full flex-col rounded-md border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-display text-lg font-semibold">
                      {t("bento.signature.title")}
                    </h3>
                    <p className="mb-5 mt-1.5 text-sm text-muted-foreground">
                      {t("bento.signature.description")}
                    </p>
                    <div className="flex-1">
                      <AnimSignature stampText={t("bento.signature.stamp")} />
                    </div>
                  </article>
                </Reveal>

                {/* OCR cherchable */}
                <Reveal delay={100} className="h-full">
                  <article className="flex h-full flex-col rounded-md border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-display text-lg font-semibold">
                      {t("bento.ocr.title")}
                    </h3>
                    <p className="mb-5 mt-1.5 text-sm text-muted-foreground">
                      {t("bento.ocr.description")}
                    </p>
                    <div className="flex-1">
                      <AnimOcr />
                    </div>
                  </article>
                </Reveal>

                {/* Formats — bande marquee */}
                <Reveal delay={150} className="h-full">
                  <article className="flex h-full flex-col justify-between rounded-md border border-border bg-card p-5 sm:p-6">
                    <div>
                      <h3 className="font-display text-lg font-semibold">
                        {t("bento.formats.title")}
                      </h3>
                      <p className="mb-5 mt-1.5 text-sm text-muted-foreground">
                        {t("bento.formats.description")}
                      </p>
                    </div>
                    <AnimFormats />
                  </article>
                </Reveal>

                {/* Compression */}
                <Reveal delay={200} className="h-full">
                  <article className="flex h-full flex-col justify-between rounded-md border border-border bg-card p-5 sm:p-6">
                    <div>
                      <h3 className="font-display text-lg font-semibold">
                        {t("bento.compression.title")}
                      </h3>
                      <p className="mb-5 mt-1.5 text-sm text-muted-foreground">
                        {t("bento.compression.description")}
                      </p>
                    </div>
                    <AnimCompression
                      before={t("bento.compression.before")}
                      after={t("bento.compression.after")}
                    />
                  </article>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            TARIFS — l'éditeur complet partout, on paie les volumes
            ════════════════════════════════════════════════════════════════ */}
        <section id="pricing" className="border-b border-border">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <div className="max-w-xl">
                <div className="mb-5 flex items-center gap-4">
                  <span aria-hidden="true" className="lp-rule w-10 shrink-0" />
                  <span className="lp-label">{t("pricing.label")}</span>
                </div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                  {t("pricing.title")}
                </h2>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
                  {t("pricing.description")}
                </p>
              </div>
            </Reveal>

            {/* Bandeau règle produit : toutes les fonctions, partout */}
            <Reveal>
              <div className="relative mb-10 mt-14">
                <CropMarks />
                <div className="rounded-md border border-primary/40 bg-primary/5 px-6 py-6">
                  <p className="font-display text-lg font-bold tracking-tight md:text-xl">
                    {t("pricing.banner.title")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground md:text-base">
                    {t("pricing.banner.subtitle")}
                  </p>
                  <ul className="mt-5 flex flex-wrap gap-x-7 gap-y-2.5">
                    {INCLUDED_EVERYWHERE.map(({ key, icon: Icon }) => (
                      <li key={key} className="flex items-center gap-2 text-sm">
                        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                        <span>{t(`pricing.included.${key}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>

            {/* Grille des forfaits */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan, planIndex) => {
                const isComingSoon = plan.id !== "free";
                const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  `GigaPDF — ${t(`pricing.plans.${plan.id}.name`)}`,
                )}`;

                return (
                  <Reveal key={plan.id} delay={50 * planIndex} className="h-full">
                    <article
                      className={cn(
                        "relative flex h-full flex-col rounded-md border bg-card p-6",
                        plan.popular ? "border-primary" : "border-border",
                      )}
                    >
                      {/* Étiquette d'angle façon cahier */}
                      <div className="mb-5 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-xl font-bold">
                            {t(`pricing.plans.${plan.id}.name`)}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t(`pricing.plans.${plan.id}.description`)}
                          </p>
                        </div>
                        {isComingSoon ? (
                          <span className="shrink-0 rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t("pricing.comingSoonBadge")}
                          </span>
                        ) : plan.popular ? (
                          <span className="shrink-0 rounded-sm border border-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
                            {t("pricing.mostPopular")}
                          </span>
                        ) : null}
                      </div>

                      <div className="mb-6 flex items-baseline gap-1">
                        {plan.id === "free" ? (
                          <span className="font-mono text-4xl font-bold">
                            {t("pricing.free")}
                          </span>
                        ) : plan.price === null ? (
                          <span className="font-display text-2xl font-bold">
                            {t("pricing.contactUs")}
                          </span>
                        ) : (
                          <>
                            <span className="font-mono text-4xl font-bold tabular-nums">
                              {plan.price}
                            </span>
                            <span className="text-muted-foreground">
                              €{t("pricing.perMonth")}
                            </span>
                          </>
                        )}
                      </div>

                      <ul className="mb-8 flex-1 space-y-2.5">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2.5 text-sm">
                            <Check
                              aria-hidden="true"
                              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                            />
                            <span>{t(`pricing.plans.${plan.id}.features.${feature}`)}</span>
                          </li>
                        ))}
                      </ul>

                      {isComingSoon ? (
                        <div className="space-y-2.5">
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled
                            aria-disabled="true"
                          >
                            {t("pricing.comingSoon")}
                          </Button>
                          <a
                            href={mailtoHref}
                            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                          >
                            <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                            {t("pricing.notifyMe")}
                          </a>
                        </div>
                      ) : (
                        <Link href="/register" className="w-full">
                          <Button className="lp-press w-full gap-2">
                            {t(`pricing.plans.${plan.id}.cta`)}
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                    </article>
                  </Reveal>
                );
              })}
            </div>

            <Reveal>
              <div className="mt-10 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("pricing.comingSoonNote")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("pricing.selfHostNote")}{" "}
                  <a
                    href={`${GITHUB_URL}#self-hosting`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4 transition-colors duration-150 hover:text-primary/80"
                  >
                    {t("pricing.selfHostLink")}
                  </a>{" "}
                  {t("pricing.forFree")}
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            BON À TIRER — CTA final
            ════════════════════════════════════════════════════════════════ */}
        <section>
          <div className="container mx-auto px-4 py-24 md:py-32">
            <Reveal>
              <div className="relative mx-auto max-w-3xl py-4 text-center">
                <CropMarks />
                <div className="border-y border-border px-4 py-14">
                  <p className="lp-label mb-5">{t("finalCta.label")}</p>
                  <h2 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl md:text-5xl">
                    {t("finalCta.title")}
                  </h2>
                  <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                    {t("finalCta.description")}
                  </p>
                  <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link href="/register">
                      <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                        {t("finalCta.ctaPrimary")}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                      <Button
                        size="lg"
                        variant="outline"
                        className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                      >
                        <Github className="h-4 w-4" />
                        {t("finalCta.ctaSecondary")}
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
