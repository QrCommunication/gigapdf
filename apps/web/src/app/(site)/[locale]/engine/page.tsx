import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Binary,
  Check,
  FileSignature,
  FileType2,
  FormInput,
  Globe,
  Highlighter,
  Image as ImageIcon,
  PenLine,
  ScanText,
  ShieldCheck,
  Type,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import { publicPageAlternates } from "@/lib/seo/hreflang";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

// ---------------------------------------------------------------------------
// PAGE MARKETING — « Le moteur PDF GigaPDF ».
//
// Présente EN DÉTAIL le moteur PDF maison (lecture/écriture bas niveau, édition
// réelle, rendu, formulaires, annotations, polices, sécurité, HTML→PDF,
// conversion, OCR) + sa philosophie 100 % maison / souveraineté.
//
// Statique par construction (SSG) comme tout le périmètre (site)/[locale] :
// la locale vient EXCLUSIVEMENT de params (setRequestLocale), AUCUN
// cookies()/getLocale(). Le root layout fournit generateStaticParams [fr,en]
// + dynamicParams=false ; cette page n'a pas de segment dynamique propre, elle
// est donc pré-rendue pour chaque locale sans generateStaticParams local.
//
// Slug identique dans les deux locales (/engine ↔ /en/engine) → hreflang via
// publicPageAlternates (helper des pages bilingues à chemin identique).
// ---------------------------------------------------------------------------

interface EnginePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: EnginePageProps): Promise<Metadata> {
  const { locale } = await params;
  // generateMetadata s'exécute hors du flux de rendu : repositionner la locale
  // statique pour que getTranslations résolve le bon dictionnaire.
  setRequestLocale(locale);
  const t = await getTranslations("engine.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicPageAlternates("/engine", locale),
  };
}

/**
 * Les onze sections détaillées du moteur. Chaque entrée mappe une sous-clé i18n
 * (engine.sections.<key>) à son icône et à la liste ordonnée de ses points
 * (engine.sections.<key>.points.<point>). L'ordre fait foi pour la numérotation
 * « 01 → 11 » façon cahier d'impression.
 */
const SECTIONS: ReadonlyArray<{
  key: string;
  icon: LucideIcon;
  points: readonly string[];
}> = [
  { key: "core", icon: Binary, points: ["lowLevel", "flate", "wasm", "souverain"] },
  { key: "edit", icon: PenLine, points: ["realEdit", "trueDelete", "redaction", "fidelity"] },
  { key: "render", icon: ImageIcon, points: ["vector", "glyphs", "previews", "images"] },
  { key: "forms", icon: FormInput, points: ["types", "fill", "flatten", "fidelity"] },
  { key: "annotations", icon: Highlighter, points: ["markup", "notes", "stamps", "standard"] },
  { key: "fonts", icon: Type, points: ["identify", "download", "embed", "cmap"] },
  { key: "security", icon: ShieldCheck, points: ["encryption", "signature", "tamper", "archive"] },
  { key: "html", icon: Globe, points: ["css", "fonts", "js", "noThirdParty"] },
  { key: "convert", icon: FileType2, points: ["office", "editable", "web", "fidelity"] },
  { key: "ocr", icon: ScanText, points: ["recognize", "layer", "searchable", "preserve"] },
  { key: "privacy", icon: FileSignature, points: ["free", "oss", "noThirdParty", "selfHost"] },
] as const;

export default async function EnginePage({ params }: EnginePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("engine");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="container mx-auto px-4 py-16 lg:py-24">
            <Reveal>
              <div className="max-w-3xl">
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
                  <Link href="/register">
                    <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                      {t("hero.ctaTry")}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/tools">
                    <Button
                      size="lg"
                      variant="outline"
                      className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                    >
                      {t("hero.ctaTools")}
                    </Button>
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── INTRO ────────────────────────────────────────────────────── */}
        <section className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <SectionHeading
                number="00"
                label={t("intro.label")}
                title={t("intro.title")}
                description={t("intro.description")}
              />
            </Reveal>
          </div>
        </section>

        {/* ── LES ONZE CAPACITÉS DU MOTEUR ─────────────────────────────── */}
        {SECTIONS.map(({ key, icon: Icon, points }, index) => {
          const number = String(index + 1).padStart(2, "0");
          const tinted = index % 2 === 0;
          return (
            <section
              key={key}
              className={`border-b border-border${tinted ? " bg-muted/20" : ""}`}
            >
              <div className="container mx-auto grid items-start gap-12 px-4 py-20 md:py-28 lg:grid-cols-2 lg:gap-20">
                <Reveal>
                  <SectionHeading
                    number={number}
                    label={t(`sections.${key}.label`)}
                    title={t(`sections.${key}.title`)}
                    description={t(`sections.${key}.description`)}
                  />
                  <span className="mt-8 hidden h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary lg:flex">
                    <Icon className="h-6 w-6" />
                  </span>
                </Reveal>
                <Reveal delay={100}>
                  <ul className="space-y-px overflow-hidden rounded-xl border border-border bg-border">
                    {points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-4 bg-background p-6"
                      >
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        />
                        <span className="text-sm leading-relaxed md:text-base">
                          {t(`sections.${key}.points.${point}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>
            </section>
          );
        })}

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
                <Link href="/register">
                  <Button size="lg" className="lp-press w-full gap-2 px-7 text-base sm:w-auto">
                    {t("cta.ctaTry")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/tools">
                  <Button
                    size="lg"
                    variant="outline"
                    className="lp-press w-full gap-2 px-7 text-base sm:w-auto"
                  >
                    {t("cta.ctaTools")}
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
