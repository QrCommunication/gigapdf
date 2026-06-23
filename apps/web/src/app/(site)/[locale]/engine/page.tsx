import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Binary,
  Check,
  FileSignature,
  Files,
  FileType2,
  FormInput,
  Globe,
  Highlighter,
  Image as ImageIcon,
  Languages,
  PenLine,
  ScanText,
  ShieldCheck,
  Sparkles,
  Type,
  Wand2,
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
 * Les douze sections détaillées du moteur. Chaque entrée mappe une sous-clé i18n
 * (engine.sections.<key>) à son icône et à la liste ordonnée de ses points
 * (engine.sections.<key>.points.<point>). L'ordre fait foi pour la numérotation
 * « 01 → 12 » façon cahier d'impression.
 */
const SECTIONS: ReadonlyArray<{
  key: string;
  icon: LucideIcon;
  points: readonly string[];
}> = [
  { key: "core", icon: Binary, points: ["lowLevel", "flate", "wasm", "souverain"] },
  { key: "edit", icon: PenLine, points: ["realEdit", "inPlace", "restyle", "tables", "lists", "opacity", "stacking", "trueDelete", "redaction", "fidelity"] },
  { key: "pages", icon: Files, points: ["rotate", "assemble", "headers", "links", "metadata"] },
  { key: "render", icon: ImageIcon, points: ["vector", "glyphs", "selective", "previews", "images"] },
  { key: "forms", icon: FormInput, points: ["types", "fill", "flatten", "fidelity"] },
  { key: "annotations", icon: Highlighter, points: ["markup", "notes", "stamps", "standard"] },
  { key: "fonts", icon: Type, points: ["identify", "download", "embed", "cmap"] },
  { key: "security", icon: ShieldCheck, points: ["encryption", "signature", "tamper", "archive"] },
  { key: "html", icon: Globe, points: ["css", "fonts", "js", "noThirdParty"] },
  { key: "convert", icon: FileType2, points: ["office", "formats", "editable", "web", "fidelity"] },
  { key: "ocr", icon: ScanText, points: ["recognize", "serverSide", "layer", "searchable", "preserve"] },
  { key: "privacy", icon: FileSignature, points: ["free", "oss", "serverSide", "localAi", "noThirdParty", "selfHost"] },
] as const;

/**
 * Lignes de la table de couverture des écritures (texte imprimé).
 * Chaque clé mappe engine.ocrSection.results.rows.<key>.{script,languages,
 * verdict}. `win` met en avant l'écriture la plus solide (latin).
 */
const OCR_RESULT_ROWS: ReadonlyArray<{ key: string; win: boolean }> = [
  { key: "latin", win: true },
  { key: "cyrillic", win: false },
  { key: "rtl", win: false },
  { key: "indic", win: false },
  { key: "cjk", win: false },
] as const;

/** « Chips » des écritures/langues prises en charge (engine.ocrSection.langs.chips.<key>). */
const OCR_LANG_CHIPS: readonly string[] = [
  "latin",
  "latinLangs",
  "cyrillic",
  "rtl",
  "tamil",
  "devanagari",
  "indic",
  "cjk",
  "print",
  "handwriting",
] as const;

/** Étapes du front-end de restauration automatique (engine.ocrSection.restore.steps.<key>). */
const OCR_RESTORE_STEPS: readonly string[] = [
  "autocrop",
  "illumination",
  "deskew",
  "despeckle",
  "binarize",
  "model",
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

        {/* ── ZOOM OCR : BENCHMARK + LANGUES + RESTAURATION ────────────── */}
        <section className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-4 py-20 md:py-28">
            <Reveal>
              <SectionHeading
                number="★"
                label={t("ocrSection.label")}
                title={t("ocrSection.title")}
                description={t("ocrSection.description")}
                className="max-w-3xl"
              />
            </Reveal>

            {/* — Table comparative CER vs Tesseract — */}
            <Reveal delay={100}>
              <div className="mt-14">
                <div className="mb-4 flex items-start gap-3">
                  <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
                    <ScanText className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="lp-label">{t("ocrSection.results.label")}</p>
                    <h3 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                      {t("ocrSection.results.title")}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t("ocrSection.results.lead")}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th scope="col" className="p-4 font-semibold">
                          {t("ocrSection.results.table.script")}
                        </th>
                        <th scope="col" className="p-4 font-semibold">
                          {t("ocrSection.results.table.languages")}
                        </th>
                        <th scope="col" className="hidden p-4 font-semibold sm:table-cell">
                          {t("ocrSection.results.table.verdict")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {OCR_RESULT_ROWS.map(({ key, win }) => (
                        <tr key={key} className="border-t border-border">
                          <th
                            scope="row"
                            className={`p-4 text-left align-top leading-relaxed ${
                              win ? "font-semibold text-primary" : "font-medium"
                            }`}
                          >
                            {t(`ocrSection.results.rows.${key}.script`)}
                          </th>
                          <td className="p-4 align-top leading-relaxed text-muted-foreground">
                            {t(`ocrSection.results.rows.${key}.languages`)}
                          </td>
                          <td className="hidden p-4 align-top sm:table-cell">
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                win ? "text-primary" : "text-muted-foreground"
                              }`}
                            >
                              {win ? (
                                <Check aria-hidden="true" className="h-3.5 w-3.5" />
                              ) : null}
                              {t(`ocrSection.results.rows.${key}.verdict`)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {t("ocrSection.results.note")}
                </p>
              </div>
            </Reveal>

            {/* — Langues / écritures (chips) — */}
            <Reveal delay={150}>
              <div className="mt-16">
                <div className="mb-5 flex items-start gap-3">
                  <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
                    <Languages className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="lp-label">{t("ocrSection.langs.label")}</p>
                    <h3 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                      {t("ocrSection.langs.title")}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t("ocrSection.langs.description")}
                    </p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-2.5">
                  {OCR_LANG_CHIPS.map((chip) => (
                    <li
                      key={chip}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm"
                    >
                      <Sparkles
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-primary"
                      />
                      {t(`ocrSection.langs.chips.${chip}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* — Restauration automatique (front-end OCR) — */}
            <Reveal delay={200}>
              <div className="mt-16">
                <div className="mb-5 flex items-start gap-3">
                  <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
                    <Wand2 className="h-5 w-5" />
                  </span>
                  <div className="max-w-3xl">
                    <p className="lp-label">{t("ocrSection.restore.label")}</p>
                    <h3 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                      {t("ocrSection.restore.title")}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-base">
                      {t("ocrSection.restore.description")}
                    </p>
                  </div>
                </div>
                <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
                  {OCR_RESTORE_STEPS.map((step) => (
                    <li key={step} className="flex items-start gap-4 bg-background p-6">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      />
                      <span className="text-sm leading-relaxed md:text-base">
                        {t(`ocrSection.restore.steps.${step}`)}
                      </span>
                    </li>
                  ))}
                </ul>
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
