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
  Terminal,
  Cpu,
  Lock,
  Layers,
  Braces,
  Download,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

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
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* ═══════════════════════════════════════════════════════════════════
            HERO SECTION - Terminal-Grade Design
            ═══════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden">
          {/* Background Effects */}
          <div className="absolute inset-0 bg-grid-dots opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

          {/* Animated gradient orbs */}
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/20 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: "-3s" }} />

          <div className="container relative mx-auto px-4 py-24 md:py-32 lg:py-40">
            <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-8 animate-fade-in">
                <Terminal className="h-4 w-4 text-primary" />
                <span className="font-mono text-primary">{t("landing.badge")}</span>
                <span className="text-muted-foreground">|</span>
                <a
                  href="https://github.com/ronylicha/gigapdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  <Star className="h-3.5 w-3.5" />
                  {t("landing.starOnGithub")}
                </a>
              </div>

              {/* Main Heading */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-slide-up">
                <span className="block">{t("landing.hero.title")}</span>
                <span className="block text-gradient mt-2">
                  {t("landing.hero.titleHighlight")}
                </span>
              </h1>

              {/* Description */}
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 animate-slide-up stagger-1">
                {t("landing.hero.description")}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 animate-slide-up stagger-2">
                <Link href="/register">
                  <Button size="lg" className="gap-2 btn-glow text-base px-8">
                    {t("landing.cta.startFreeTrial")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <a
                  href="https://github.com/ronylicha/gigapdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="lg" variant="outline" className="gap-2 text-base px-8">
                    <Github className="h-4 w-4" />
                    {t("landing.cta.viewOnGithub")}
                  </Button>
                </a>
              </div>

              {/* Terminal Preview */}
              <div className="mt-16 w-full max-w-3xl animate-slide-up stagger-3">
                <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden shadow-2xl">
                  {/* Terminal Header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/80" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                      <div className="w-3 h-3 rounded-full bg-green-500/80" />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono ml-2">terminal</span>
                  </div>
                  {/* Terminal Content */}
                  <div className="p-6 font-mono text-sm space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-terminal-green">$</span>
                      <span className="text-foreground">npx gigapdf init my-project</span>
                    </div>
                    <div className="text-muted-foreground pl-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-terminal-amber" />
                        <span>Creating project structure...</span>
                      </div>
                    </div>
                    <div className="text-muted-foreground pl-4">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4 text-terminal-cyan" />
                        <span>Installing dependencies...</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-terminal-green">
                      <Check className="h-4 w-4" />
                      <span>Ready! Run `cd my-project && pnpm dev`</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            FEATURES SECTION - Tech Cards
            ═══════════════════════════════════════════════════════════════════ */}
        <section id="features" className="py-24 md:py-32 relative">
          <div className="absolute inset-0 bg-grid-dots opacity-30" />

          <div className="container relative mx-auto px-4">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm mb-6">
                <Cpu className="h-4 w-4 text-primary" />
                <span className="font-mono">features</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
                {t("landing.features.title")}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("landing.features.description")}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
              {/* Feature Card 1 - WYSIWYG Editor */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6 group-hover:glow-green transition-shadow">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t("landing.features.wysiwyg.title")}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {t("landing.features.wysiwyg.description")}
                  </p>
                </div>
              </div>

              {/* Feature Card 2 - Real-time Collaboration */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-6 group-hover:glow-cyan transition-shadow">
                    <Zap className="h-6 w-6 text-accent" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t("landing.features.collaboration.title")}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {t("landing.features.collaboration.description")}
                  </p>
                </div>
              </div>

              {/* Feature Card 3 - Enterprise Security */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-terminal-purple/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-terminal-purple/10 flex items-center justify-center mb-6">
                    <Shield className="h-6 w-6 text-terminal-purple" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t("landing.features.security.title")}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {t("landing.features.security.description")}
                  </p>
                </div>
              </div>

              {/* Feature Card 4 - REST API */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-terminal-amber/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-terminal-amber/10 flex items-center justify-center mb-6">
                    <Braces className="h-6 w-6 text-terminal-amber" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">REST API</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Full programmatic access to all features. Automate document workflows with our comprehensive API.
                  </p>
                </div>
              </div>

              {/* Feature Card 5 - Multi-format Export */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-terminal-cyan/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-terminal-cyan/10 flex items-center justify-center mb-6">
                    <Layers className="h-6 w-6 text-terminal-cyan" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Multi-format Export</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Export to PNG, JPEG, DOCX, HTML and more. OCR support for scanned documents with Tesseract.
                  </p>
                </div>
              </div>

              {/* Feature Card 6 - Self-hostable */}
              <div className="group relative rounded-xl border border-border bg-card/50 backdrop-blur-sm p-8 card-hover">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-terminal-green/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-lg bg-terminal-green/10 flex items-center justify-center mb-6">
                    <Lock className="h-6 w-6 text-terminal-green" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Self-hostable</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Deploy on your own infrastructure. Keep complete control over your documents and data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            OPEN SOURCE SECTION - Terminal Style
            ═══════════════════════════════════════════════════════════════════ */}
        <section id="open-source" className="py-24 md:py-32 border-y border-border bg-muted/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-lines opacity-30" />

          <div className="container relative mx-auto px-4">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 rounded-full border border-terminal-green/30 bg-terminal-green/10 px-4 py-1.5 text-sm mb-6">
                <Heart className="h-4 w-4 text-terminal-green" />
                <span className="font-mono text-terminal-green">{t("landing.openSource.badge")}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
                {t("landing.openSource.title")}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("landing.openSource.description")}
              </p>
            </div>

            {/* Code Block Showcase */}
            <div className="max-w-4xl mx-auto mb-16">
              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/80" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                      <div className="w-3 h-3 rounded-full bg-green-500/80" />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">quickstart.sh</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                    <ExternalLink className="h-3 w-3" />
                    View on GitHub
                  </Button>
                </div>
                <div className="p-6 font-mono text-sm space-y-2 overflow-x-auto">
                  <div className="text-muted-foreground"># Clone the repository</div>
                  <div><span className="text-terminal-green">$</span> git clone https://github.com/ronylicha/gigapdf.git</div>
                  <div className="text-muted-foreground mt-4"># Install dependencies</div>
                  <div><span className="text-terminal-green">$</span> cd gigapdf && pnpm install</div>
                  <div className="text-muted-foreground mt-4"># Start development server</div>
                  <div><span className="text-terminal-green">$</span> pnpm dev:all</div>
                  <div className="mt-4 text-terminal-cyan">
                    # API: http://localhost:8000 | Web: http://localhost:3000
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-12 max-w-5xl mx-auto">
              <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6 text-center card-hover">
                <Code2 className="h-8 w-8 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-1">{t("landing.openSource.mitLicense.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.mitLicense.description")}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6 text-center card-hover">
                <Users className="h-8 w-8 text-accent mx-auto mb-4" />
                <h3 className="font-semibold mb-1">{t("landing.openSource.selfHostable.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.selfHostable.description")}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6 text-center card-hover">
                <GitFork className="h-8 w-8 text-terminal-amber mx-auto mb-4" />
                <h3 className="font-semibold mb-1">{t("landing.openSource.contribute.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.contribute.description")}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6 text-center card-hover">
                <BookOpen className="h-8 w-8 text-terminal-purple mx-auto mb-4" />
                <h3 className="font-semibold mb-1">{t("landing.openSource.documentation.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("landing.openSource.documentation.description")}
                </p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://github.com/ronylicha/gigapdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" variant="outline" className="gap-2">
                  <Github className="h-5 w-5" />
                  {t("landing.starOnGithub")}
                </Button>
              </a>
              <a
                href="https://github.com/ronylicha/gigapdf/blob/main/CONTRIBUTING.md"
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

        {/* ═══════════════════════════════════════════════════════════════════
            PRICING SECTION - Glowing Cards
            ═══════════════════════════════════════════════════════════════════ */}
        <section id="pricing" className="py-24 md:py-32 relative">
          <div className="absolute inset-0 bg-grid-dots opacity-30" />

          <div className="container relative mx-auto px-4">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm mb-6">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-mono">pricing</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
                {t("landing.pricing.title")}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("landing.pricing.description")}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`relative rounded-xl border bg-card/50 backdrop-blur-sm p-6 flex flex-col transition-all duration-300 ${
                    plan.popular
                      ? "border-primary shadow-lg scale-[1.02] lg:scale-105"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {/* Popular Badge */}
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-primary px-4 py-1 text-xs font-medium text-primary-foreground shadow-lg">
                        {t("landing.pricing.mostPopular")}
                      </span>
                    </div>
                  )}

                  {/* Plan Header */}
                  <div className="mb-6">
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {plan.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      {plan.price === 0 && plan.id === "free" ? (
                        <span className="text-4xl font-bold font-mono">{t("landing.pricing.free")}</span>
                      ) : plan.price === 0 && plan.id === "enterprise" ? (
                        <span className="text-2xl font-bold">{t("landing.pricing.contactUs")}</span>
                      ) : (
                        <>
                          <span className="text-4xl font-bold font-mono">{plan.price}</span>
                          <span className="text-muted-foreground">
                            {plan.currency}{t("landing.pricing.perMonth")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Features List */}
                  <ul className="mb-8 space-y-3 flex-1">
                    {plan.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA Button */}
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
                      className={`w-full gap-2 ${plan.popular ? "btn-glow" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                    >
                      {plan.cta}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>

            {/* Self-host Note */}
            <div className="mt-12 text-center">
              <p className="text-muted-foreground inline-flex items-center gap-2 flex-wrap justify-center">
                <Terminal className="h-4 w-4" />
                {t("landing.pricing.selfHostNote")}{" "}
                <a
                  href="https://github.com/ronylicha/gigapdf#self-hosting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t("landing.pricing.selfHostLink")}
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                {t("landing.pricing.forFree")}
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            FINAL CTA SECTION
            ═══════════════════════════════════════════════════════════════════ */}
        <section className="py-24 md:py-32 border-t border-border relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent" />
          <div className="absolute inset-0 bg-grid-dots opacity-30" />

          <div className="container relative mx-auto px-4 text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
              {t("landing.finalCta.title")}
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
              {t("landing.finalCta.description")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="gap-2 btn-glow text-base px-8">
                  {t("landing.cta.startFreeTrial")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/docs">
                <Button size="lg" variant="outline" className="gap-2 text-base px-8">
                  <BookOpen className="h-4 w-4" />
                  {t("landing.cta.readDocs")}
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
