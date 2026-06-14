import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Eye,
  GitFork,
  GitPullRequest,
  Layers,
  PenLine,
  Scale,
  Server,
  Star,
  Unlock,
  Users,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import { GithubIcon as Github } from "@/components/icons/github-icon";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { OpenSourceIllustration } from "@/components/landing/open-source-illustration";

const GITHUB_URL = "https://github.com/QrCommunication/gigapdf";

interface OpenSourcePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: OpenSourcePageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("openSource.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicPageAlternates("/open-source", locale),
  };
}

const PILLARS = [
  { key: "transparency", icon: Eye },
  { key: "selfHost", icon: Server },
  { key: "noLockIn", icon: Unlock },
  { key: "community", icon: Users },
] as const;

const LICENSE_POINTS = ["use", "network", "trademark"] as const;
const STACK_ITEMS = ["frontend", "engine", "backend", "data"] as const;
const CONTRIBUTE_STEPS = [
  { key: "fork", icon: GitFork },
  { key: "dco", icon: PenLine },
  { key: "pr", icon: GitPullRequest },
] as const;

export default async function OpenSourcePage({ params }: OpenSourcePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("openSource");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="container mx-auto grid items-center gap-12 px-4 py-16 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:py-24">
            <Reveal>
              <div className="max-w-xl">
                <p className="lp-label mb-6 flex items-center gap-3">
                  <span aria-hidden="true" className="h-1.5 w-1.5 bg-primary" />
                  {t("hero.kicker")}
                </p>
                <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
                  {t("hero.title")}{" "}
                  <span className="text-primary">{t("hero.titleAccent")}</span>
                </h1>
                <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                  {t("hero.description")}
                </p>
                <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                  <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                    <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                      <Github className="h-4 w-4" />
                      {t("hero.ctaGithub")}
                    </Button>
                  </a>
                  <Link href="/docs">
                    <Button
                      size="lg"
                      variant="outline"
                      className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                    >
                      {t("hero.ctaSelfHost")}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="px-2 sm:px-6 lg:px-2">
                <OpenSourceIllustration />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── PILIERS ──────────────────────────────────────────────────── */}
        <section className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <SectionHeading
                number="01"
                label={t("pillars.label")}
                title={t("pillars.title")}
              />
            </Reveal>
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {PILLARS.map(({ key, icon: Icon }, i) => (
                <Reveal key={key} delay={i * 60}>
                  <div className="flex h-full flex-col gap-4 bg-background p-7">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="font-display text-lg font-semibold">
                      {t(`pillars.${key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t(`pillars.${key}.description`)}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── LICENCE ──────────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="container mx-auto grid items-start gap-12 px-4 py-20 md:py-28 lg:grid-cols-2 lg:gap-20">
            <Reveal>
              <SectionHeading
                number="02"
                label={t("license.label")}
                title={t("license.title")}
                description={t("license.description")}
              />
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={`${GITHUB_URL}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm" className="lp-press gap-2">
                    <Scale className="h-4 w-4" />
                    {t("license.linkLicense")}
                  </Button>
                </a>
                <a
                  href={`${GITHUB_URL}/blob/main/TRADEMARK.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="ghost" size="sm" className="lp-press">
                    {t("license.linkTrademark")}
                  </Button>
                </a>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <ul className="space-y-px overflow-hidden rounded-xl border border-border bg-border">
                {LICENSE_POINTS.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-4 bg-background p-6"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1 font-mono text-xs text-primary"
                    >
                      §
                    </span>
                    <span className="text-sm leading-relaxed md:text-base">
                      {t(`license.points.${point}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ── STACK ────────────────────────────────────────────────────── */}
        <section className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <SectionHeading
                number="03"
                label={t("stack.label")}
                title={t("stack.title")}
                description={t("stack.description")}
              />
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STACK_ITEMS.map((item, i) => (
                <Reveal key={item} delay={i * 60}>
                  <div className="flex h-full items-start gap-3 rounded-lg border border-border bg-background p-5">
                    <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="font-mono text-xs leading-relaxed text-muted-foreground">
                      {t(`stack.items.${item}`)}
                    </span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── CONTRIBUER ───────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <SectionHeading
                number="04"
                label={t("contribute.label")}
                title={t("contribute.title")}
                description={t("contribute.description")}
              />
            </Reveal>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {CONTRIBUTE_STEPS.map(({ key, icon: Icon }, i) => (
                <Reveal key={key} delay={i * 70}>
                  <li className="flex h-full flex-col gap-4 rounded-xl border border-border p-7">
                    <div className="flex items-center justify-between">
                      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="font-mono text-sm tabular-nums text-muted-foreground">
                        0{i + 1}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed md:text-base">
                      {t(`contribute.steps.${key}`)}
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
            <Reveal delay={120}>
              <div className="mt-10 flex flex-wrap gap-3">
                {(
                  [
                    { href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`, key: "ctaContributing", icon: <GitFork className="h-4 w-4" /> },
                    { href: `${GITHUB_URL}/issues`, key: "ctaIssues", icon: <GitPullRequest className="h-4 w-4" /> },
                    { href: `${GITHUB_URL}/discussions`, key: "ctaDiscussions", icon: <Users className="h-4 w-4" /> },
                  ] as { href: string; key: string; icon: ReactNode }[]
                ).map(({ href, key, icon }) => (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="lp-press gap-2">
                      {icon}
                      {t(`contribute.${key}`)}
                    </Button>
                  </a>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── CTA FINAL ────────────────────────────────────────────────── */}
        <section className="border-b border-border bg-muted/30">
          <div className="container mx-auto px-4 py-20 text-center md:py-28">
            <Reveal>
              <h2 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                {t("cta.title")}
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
                {t("cta.description")}
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                    <Star className="h-4 w-4" />
                    {t("cta.ctaGithub")}
                  </Button>
                </a>
                <Link href="/register">
                  <Button
                    size="lg"
                    variant="outline"
                    className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                  >
                    {t("cta.ctaTry")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
