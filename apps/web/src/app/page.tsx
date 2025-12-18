"use client";

import Link from "next/link";
import { Button } from "@giga-pdf/ui";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  FileText,
  Zap,
  Shield,
  Github,
  Check,
  Code2,
  Users,
  BookOpen,
  Heart,
  Star,
  GitFork,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function HomePage() {
  const t = useTranslations();

  const plans = [
    {
      id: "free",
      name: t("landing.pricing.plans.free.name"),
      description: t("landing.pricing.plans.free.description"),
      price: 0,
      currency: "EUR",
      interval: "month",
      features: [
        t("landing.pricing.plans.free.features.storage"),
        t("landing.pricing.plans.free.features.apiCalls"),
        t("landing.pricing.plans.free.features.documents"),
        t("landing.pricing.plans.free.features.editing"),
        t("landing.pricing.plans.free.features.support"),
      ],
      cta: t("landing.pricing.plans.free.cta"),
      popular: false,
    },
    {
      id: "starter",
      name: t("landing.pricing.plans.starter.name"),
      description: t("landing.pricing.plans.starter.description"),
      price: 9,
      currency: "EUR",
      interval: "month",
      features: [
        t("landing.pricing.plans.starter.features.storage"),
        t("landing.pricing.plans.starter.features.apiCalls"),
        t("landing.pricing.plans.starter.features.documents"),
        t("landing.pricing.plans.starter.features.editing"),
        t("landing.pricing.plans.starter.features.support"),
        t("landing.pricing.plans.starter.features.trial"),
      ],
      cta: t("landing.pricing.plans.starter.cta"),
      popular: true,
    },
    {
      id: "pro",
      name: t("landing.pricing.plans.pro.name"),
      description: t("landing.pricing.plans.pro.description"),
      price: 29,
      currency: "EUR",
      interval: "month",
      features: [
        t("landing.pricing.plans.pro.features.storage"),
        t("landing.pricing.plans.pro.features.apiCalls"),
        t("landing.pricing.plans.pro.features.documents"),
        t("landing.pricing.plans.pro.features.branding"),
        t("landing.pricing.plans.pro.features.support"),
        t("landing.pricing.plans.pro.features.api"),
        t("landing.pricing.plans.pro.features.trial"),
      ],
      cta: t("landing.pricing.plans.pro.cta"),
      popular: false,
    },
    {
      id: "enterprise",
      name: t("landing.pricing.plans.enterprise.name"),
      description: t("landing.pricing.plans.enterprise.description"),
      price: 0,
      currency: "EUR",
      interval: "month",
      features: [
        t("landing.pricing.plans.enterprise.features.storage"),
        t("landing.pricing.plans.enterprise.features.apiCalls"),
        t("landing.pricing.plans.enterprise.features.documents"),
        t("landing.pricing.plans.enterprise.features.branding"),
        t("landing.pricing.plans.enterprise.features.sla"),
        t("landing.pricing.plans.enterprise.features.accountManager"),
        t("landing.pricing.plans.enterprise.features.support"),
        t("landing.pricing.plans.enterprise.features.integrations"),
      ],
      cta: t("landing.pricing.plans.enterprise.cta"),
      popular: false,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6" />
            <span className="text-xl font-bold">GigaPDF</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground">
              {t("nav.features")}
            </a>
            <a href="#open-source" className="text-sm text-muted-foreground hover:text-foreground">
              {t("nav.openSource")}
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">
              {t("nav.pricing")}
            </a>
            <a
              href="https://github.com/gigapdf/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Github className="h-4 w-4" />
              {t("nav.github")}
            </a>
          </nav>
          <div className="flex items-center gap-2 md:gap-4">
            <LanguageSwitcher />
            <Link href="/login">
              <Button variant="ghost">{t("nav.signIn")}</Button>
            </Link>
            <Link href="/register">
              <Button>{t("nav.getStarted")}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="container mx-auto flex flex-col items-center justify-center gap-4 px-4 py-24 text-center md:py-32">
          <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm">
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            <span>{t("landing.badge")}</span>
            <span className="text-muted-foreground">|</span>
            <a
              href="https://github.com/gigapdf/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t("landing.starOnGithub")}
            </a>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
              {t("landing.hero.title")}
              <br />
              <span className="text-primary">{t("landing.hero.titleHighlight")}</span>
            </h1>
            <p className="mx-auto max-w-[700px] text-lg text-muted-foreground md:text-xl">
              {t("landing.hero.description")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/register">
              <Button size="lg" className="gap-2">
                {t("landing.cta.startFreeTrial")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a
              href="https://github.com/gigapdf/gigapdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" variant="outline" className="gap-2">
                <Github className="h-4 w-4" />
                {t("landing.cta.viewOnGithub")}
              </Button>
            </a>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container mx-auto px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
              {t("landing.features.title")}
            </h2>
            <p className="mx-auto max-w-[700px] text-muted-foreground">
              {t("landing.features.description")}
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <FileText className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold">{t("landing.features.wysiwyg.title")}</h3>
              <p className="text-muted-foreground">
                {t("landing.features.wysiwyg.description")}
              </p>
            </div>
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold">{t("landing.features.collaboration.title")}</h3>
              <p className="text-muted-foreground">
                {t("landing.features.collaboration.description")}
              </p>
            </div>
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold">{t("landing.features.security.title")}</h3>
              <p className="text-muted-foreground">
                {t("landing.features.security.description")}
              </p>
            </div>
          </div>
        </section>

        {/* Open Source Section */}
        <section id="open-source" className="border-y bg-muted/30 py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-1.5 text-sm text-green-600 mb-4">
                <Heart className="h-4 w-4" />
                <span>{t("landing.openSource.badge")}</span>
              </div>
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
                {t("landing.openSource.title")}
              </h2>
              <p className="mx-auto max-w-[700px] text-muted-foreground">
                {t("landing.openSource.description")}
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4 mb-12 max-w-6xl mx-auto">
              <div className="rounded-lg border bg-card p-6 text-center">
                <Code2 className="h-10 w-10 text-primary mx-auto mb-4" />
                <h3 className="font-bold mb-2">{t("landing.openSource.mitLicense.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.mitLicense.description")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-6 text-center">
                <Users className="h-10 w-10 text-primary mx-auto mb-4" />
                <h3 className="font-bold mb-2">{t("landing.openSource.selfHostable.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.selfHostable.description")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-6 text-center">
                <GitFork className="h-10 w-10 text-primary mx-auto mb-4" />
                <h3 className="font-bold mb-2">{t("landing.openSource.contribute.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.contribute.description")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-6 text-center">
                <BookOpen className="h-10 w-10 text-primary mx-auto mb-4" />
                <h3 className="font-bold mb-2">{t("landing.openSource.documentation.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.documentation.description")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://github.com/gigapdf/gigapdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" variant="outline" className="gap-2">
                  <Github className="h-5 w-5" />
                  {t("landing.starOnGithub")}
                </Button>
              </a>
              <a
                href="https://github.com/gigapdf/gigapdf/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" variant="outline" className="gap-2">
                  <Heart className="h-5 w-5" />
                  {t("landing.openSource.contributionGuide")}
                </Button>
              </a>
              <Link href="/docs">
                <Button size="lg" variant="outline" className="gap-2">
                  <BookOpen className="h-5 w-5" />
                  {t("landing.openSource.readTheDocs")}
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="container mx-auto px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
              {t("landing.pricing.title")}
            </h2>
            <p className="mx-auto max-w-[700px] text-muted-foreground">
              {t("landing.pricing.description")}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-xl border bg-card p-6 flex flex-col ${
                  plan.popular
                    ? "ring-2 ring-primary shadow-lg scale-105 relative"
                    : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      {t("landing.pricing.mostPopular")}
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {plan.description}
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    {plan.price === 0 && plan.id === "free" ? (
                      <span className="text-4xl font-bold">{t("landing.pricing.free")}</span>
                    ) : plan.price === 0 && plan.id === "enterprise" ? (
                      <span className="text-2xl font-bold">{t("landing.pricing.contactUs")}</span>
                    ) : (
                      <>
                        <span className="text-4xl font-bold">{plan.price}</span>
                        <span className="text-muted-foreground">
                          {plan.currency}{t("landing.pricing.perMonth")}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <ul className="mb-6 space-y-3 flex-1">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={
                    plan.id === "enterprise"
                      ? "/contact"
                      : plan.id === "free"
                      ? "/register"
                      : `/register?plan=${plan.id}`
                  }
                  className="w-full"
                >
                  <Button
                    className="w-full"
                    variant={plan.popular ? "default" : "outline"}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-muted-foreground">
              {t("landing.pricing.selfHostNote")}{" "}
              <a
                href="https://github.com/gigapdf/gigapdf#self-hosting"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {t("landing.pricing.selfHostLink")}
              </a>{" "}
              {t("landing.pricing.forFree")}
            </p>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t bg-muted/30 py-24">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl mb-4">
              {t("landing.finalCta.title")}
            </h2>
            <p className="mx-auto max-w-[500px] text-muted-foreground mb-8">
              {t("landing.finalCta.description")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="gap-2">
                  {t("landing.cta.startFreeTrial")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/docs">
                <Button size="lg" variant="outline">
                  {t("landing.cta.readDocs")}
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-4 max-w-6xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-6 w-6" />
                <span className="text-xl font-bold">GigaPDF</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {t("landing.footer.tagline")}
              </p>
              <div className="flex gap-4">
                <a
                  href="https://github.com/gigapdf/gigapdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Github className="h-5 w-5" />
                </a>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t("landing.footer.product.title")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="#features" className="hover:text-foreground">
                    {t("landing.footer.product.features")}
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-foreground">
                    {t("landing.footer.product.pricing")}
                  </a>
                </li>
                <li>
                  <Link href="/docs" className="hover:text-foreground">
                    {t("landing.footer.product.documentation")}
                  </Link>
                </li>
                <li>
                  <Link href="/changelog" className="hover:text-foreground">
                    {t("landing.footer.product.changelog")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t("landing.footer.openSource.title")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="https://github.com/gigapdf/gigapdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    {t("landing.footer.openSource.repository")}
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/gigapdf/gigapdf/blob/main/CONTRIBUTING.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    {t("landing.footer.openSource.contributing")}
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/gigapdf/gigapdf/blob/main/LICENSE"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    {t("landing.footer.openSource.license")}
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/gigapdf/gigapdf#self-hosting"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    {t("landing.footer.openSource.selfHosting")}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t("landing.footer.company.title")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/about" className="hover:text-foreground">
                    {t("landing.footer.company.about")}
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-foreground">
                    {t("landing.footer.company.privacy")}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-foreground">
                    {t("landing.footer.company.terms")}
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="hover:text-foreground">
                    {t("landing.footer.company.contact")}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground max-w-6xl mx-auto">
            <p>
              GigaPDF. {t("landing.footer.madeWith")}{" "}
              <Heart className="h-4 w-4 inline text-red-500 fill-red-500" />{" "}
              {t("landing.footer.byOpenSource")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
