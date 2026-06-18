"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { GithubIcon as Github } from "@/components/icons/github-icon";
import {
  BookOpen,
  FileJson,
  ExternalLink,
  Download,
  Braces,
  FileCode,
  ArrowRight,
  Scale,
  Container,
  Server,
  Network,
  Database,
  KeyRound,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";

const REPO_URL = "https://github.com/QrCommunication/gigapdf";
const LICENSE_URL = "https://github.com/QrCommunication/gigapdf/blob/main/LICENSE";

/** Static lucide icon per feature key (no dynamic class names — purge-safe). */
const FEATURE_KEYS = [
  "editing",
  "forms",
  "signature",
  "ocr",
  "office",
  "ged",
  "realtime",
  "api",
] as const;

export default function DocsContent() {
  const t = useTranslations("legal.docs");

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "https://giga-pdf.com";

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-terminal-cyan/30 bg-terminal-cyan/5 px-4 py-1.5 text-sm mb-6">
          <BookOpen className="h-4 w-4 text-terminal-cyan" />
          <span className="font-mono text-terminal-cyan">documentation</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">{t("subtitle")}</p>
      </div>

      {/* Overview */}
      <section className="mb-14">
        <div className="flex items-center gap-3 mb-5 not-prose">
          <h2 className="text-2xl font-bold">{t("overview.title")}</h2>
          <span className="inline-flex items-center rounded-full bg-terminal-green/10 px-2.5 py-0.5 text-xs font-medium text-terminal-green">
            {t("overview.badge")}
          </span>
        </div>
        <p className="text-muted-foreground mb-4 max-w-3xl">{t("overview.p1")}</p>
        <p className="text-muted-foreground mb-6 max-w-3xl">{t("overview.p2")}</p>
        <div className="flex flex-wrap gap-3 not-prose">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2">
              <Github className="h-4 w-4" />
              {t("overview.repo")}
            </Button>
          </a>
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" className="gap-2">
              <Scale className="h-4 w-4" />
              {t("overview.license")}
            </Button>
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold mb-6">{t("features.title")}</h2>
        <div className="grid gap-4 md:grid-cols-2 not-prose">
          {FEATURE_KEYS.map((key, index) => (
            <div
              key={key}
              className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4"
            >
              <span className="text-terminal-cyan font-mono text-sm pt-0.5 shrink-0">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-sm">{t(`features.${key}`)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/* Self-hosting — the core, detailed section                    */}
      {/* ============================================================ */}
      <section className="mb-14">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <Server className="h-6 w-6 text-terminal-purple" />
          <h2 className="text-2xl font-bold">{t("selfhost.title")}</h2>
        </div>
        <p className="text-muted-foreground mb-6 max-w-3xl">{t("selfhost.intro")}</p>

        {/* Environment variables */}
        <div className="mb-10 rounded-xl border border-border bg-card/50 p-6 not-prose">
          <p className="text-sm text-muted-foreground mb-4">{t("selfhost.envNote")}</p>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-5">
            <span className="text-terminal-green">$</span> git clone {REPO_URL}.git{"\n"}
            <span className="text-terminal-green">$</span> cd gigapdf{"\n"}
            <span className="text-terminal-green">$</span> cp .env.example .env
          </div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-terminal-amber" />
            {t("selfhost.envVars.title")}
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              "postgres",
              "redis",
              "secret",
              "auth",
              "s3",
              "smtp",
              "stripe",
              "legal",
            ].map((k) => (
              <li key={k} className="flex gap-2">
                <span className="text-terminal-cyan shrink-0">·</span>
                <span>{t(`selfhost.envVars.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Method A — Docker */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3 not-prose">
            <Container className="h-5 w-5 text-terminal-green" />
            <h3 className="text-xl font-bold">{t("selfhost.docker.title")}</h3>
          </div>
          <p className="text-muted-foreground mb-3 max-w-3xl">
            {t("selfhost.docker.description")}
          </p>
          <p className="text-sm text-muted-foreground mb-4">{t("selfhost.docker.prereq")}</p>

          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-5 not-prose">
            <span className="text-terminal-green">$</span> docker compose up -d
          </div>

          <p className="text-sm font-medium mb-3">{t("selfhost.docker.servicesTitle")}</p>
          <ul className="space-y-2 text-sm text-muted-foreground mb-5 not-prose">
            {["postgres", "redis", "api", "worker", "beat", "web", "admin"].map((k) => (
              <li key={k} className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 text-terminal-green shrink-0 mt-0.5" />
                <span className="font-mono text-xs sm:text-sm">
                  {t(`selfhost.docker.services.${k}`)}
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-terminal-cyan/20 bg-terminal-cyan/5 p-4 mb-5 not-prose">
            <p className="text-sm text-muted-foreground">{t("selfhost.docker.bundledNote")}</p>
          </div>

          <p className="text-sm text-muted-foreground mb-3">{t("selfhost.docker.migrateNote")}</p>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre not-prose">
            <span className="text-terminal-green">$</span> docker compose exec api alembic upgrade head
          </div>
        </div>

        {/* Method B — Native */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3 not-prose">
            <Terminal className="h-5 w-5 text-terminal-amber" />
            <h3 className="text-xl font-bold">{t("selfhost.native.title")}</h3>
          </div>
          <p className="text-muted-foreground mb-4 max-w-3xl">
            {t("selfhost.native.description")}
          </p>

          {/* Prerequisites */}
          <p className="text-sm font-medium mb-3">{t("selfhost.native.prereqTitle")}</p>
          <ul className="space-y-2 text-sm text-muted-foreground mb-6 not-prose">
            {["node", "python", "postgres", "redis"].map((k) => (
              <li key={k} className="flex gap-2">
                <span className="text-terminal-amber shrink-0">·</span>
                <span>{t(`selfhost.native.prereq.${k}`)}</span>
              </li>
            ))}
          </ul>

          {/* No system binaries needed: the WASM engine (gigapdf-lib) is
              self-contained for Office/HTML/OCR/font work — no LibreOffice,
              fontforge or Chromium to install. */}

          {/* Backend */}
          <h4 className="font-semibold mb-2">{t("selfhost.native.backendTitle")}</h4>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-3 not-prose">
            <span className="text-terminal-green">$</span> python -m venv .venv{"\n"}
            <span className="text-terminal-green">$</span> source .venv/bin/activate{"\n"}
            <span className="text-terminal-green">$</span> pip install -r requirements.txt{"\n"}
            <span className="text-terminal-green">$</span> alembic upgrade head
          </div>
          <div className="rounded-lg border border-terminal-amber/20 bg-terminal-amber/5 p-4 mb-6 not-prose">
            <p className="text-sm text-muted-foreground">{t("selfhost.native.backendNote")}</p>
          </div>

          {/* Frontend */}
          <h4 className="font-semibold mb-2">{t("selfhost.native.frontendTitle")}</h4>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-3 not-prose">
            <span className="text-terminal-green">$</span> pnpm install{"\n"}
            <span className="text-terminal-green">$</span> pnpm build
          </div>
          <p className="text-sm text-muted-foreground mb-6">{t("selfhost.native.frontendNote")}</p>

          {/* Run */}
          <h4 className="font-semibold mb-2">{t("selfhost.native.runTitle")}</h4>
          <p className="text-sm text-muted-foreground mb-3">{t("selfhost.native.runNote")}</p>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-4 not-prose">
            <span className="text-muted-foreground"># API</span>
            {"\n"}
            <span className="text-terminal-green">$</span> uvicorn app.main:app --host 0.0.0.0 --port 8000{"\n"}
            <span className="text-muted-foreground"># Async workers</span>
            {"\n"}
            <span className="text-terminal-green">$</span> celery -A app.tasks.celery_app worker{"\n"}
            <span className="text-terminal-green">$</span> celery -A app.tasks.celery_app beat{"\n"}
            <span className="text-muted-foreground"># Web app (Next.js standalone)</span>
            {"\n"}
            <span className="text-terminal-green">$</span> node apps/web/.next/standalone/apps/web/server.js
          </div>

          <p className="text-sm font-medium mb-3">{t("selfhost.native.rolesTitle")}</p>
          <ul className="space-y-2 text-sm text-muted-foreground not-prose">
            {["uvicorn", "worker", "beat", "web"].map((k) => (
              <li key={k} className="flex gap-2">
                <span className="text-terminal-amber shrink-0">·</span>
                <span>{t(`selfhost.native.roles.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Nginx routing */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3 not-prose">
            <Network className="h-5 w-5 text-terminal-cyan" />
            <h3 className="text-xl font-bold">{t("selfhost.nginx.title")}</h3>
          </div>
          <p className="text-muted-foreground mb-4 max-w-3xl">{t("selfhost.nginx.description")}</p>
          <ul className="space-y-2 text-sm text-muted-foreground mb-4 not-prose">
            {["v1", "docs", "default", "root"].map((k) => (
              <li
                key={k}
                className="font-mono text-xs sm:text-sm bg-muted/40 rounded px-3 py-2"
              >
                {t(`selfhost.nginx.${k}`)}
              </li>
            ))}
          </ul>
          <a
            href={`${REPO_URL}/blob/main/deploy/nginx.conf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline not-prose"
          >
            {t("selfhost.nginx.ref")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Migrations */}
        <div className="mb-8 rounded-xl border border-terminal-amber/30 bg-terminal-amber/5 p-6 not-prose">
          <div className="flex items-center gap-3 mb-3">
            <Database className="h-5 w-5 text-terminal-amber" />
            <h3 className="text-lg font-bold">{t("selfhost.migrate.title")}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t("selfhost.migrate.description")}</p>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre mb-3">
            <span className="text-terminal-green">$</span> source .venv/bin/activate{"\n"}
            <span className="text-terminal-green">$</span> alembic upgrade head{"\n"}
            <span className="text-terminal-green">$</span> alembic current
          </div>
          <p className="text-sm text-muted-foreground">{t("selfhost.migrate.verifyNote")}</p>
        </div>

        <a
          href={`${REPO_URL}#quick-start-self-hosting`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline not-prose"
        >
          {t("selfhost.readme")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </section>

      {/* ============================================================ */}
      {/* API & developers                                             */}
      {/* ============================================================ */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold mb-4">{t("api.title")}</h2>
        <p className="text-muted-foreground mb-6 max-w-3xl">{t("api.intro")}</p>

        {/* Authentication */}
        <div className="rounded-xl border border-border bg-card/50 p-6 mb-6 not-prose">
          <h3 className="font-semibold text-lg mb-2">{t("api.authTitle")}</h3>
          <p className="text-sm text-muted-foreground mb-4">{t("api.authDescription")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto">
              <span className="text-terminal-purple">Authorization:</span>{" "}
              <span className="text-terminal-green">Bearer</span>{" "}
              <span className="text-muted-foreground">&lt;token&gt;</span>
            </div>
            <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto">
              <span className="text-terminal-purple">X-API-Key:</span>{" "}
              <span className="text-muted-foreground">&lt;your-api-key&gt;</span>
            </div>
          </div>
        </div>

        {/* API keys. La carte « Embed widget » est masquée tant que l'embed
            SDK (@giga-pdf/embed) n'est pas publié — /docs/embed redirige vers
            /docs en attendant. Restaurer la grille md:grid-cols-2 + le <Link
            href="/docs/embed"> quand le SDK sera dispo. */}
        <div className="mb-6 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="h-5 w-5 text-terminal-amber" />
              <h3 className="font-semibold text-lg">{t("api.keysTitle")}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4 flex-1">{t("api.keysDescription")}</p>
            <Link
              href="/developers"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              {t("api.keysLink")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Interactive docs */}
        <h3 className="text-xl font-bold mb-4">{t("api.interactiveTitle")}</h3>
        <div className="grid gap-6 md:grid-cols-2 mb-6 not-prose">
          {/* Swagger UI */}
          <a
            href={`${apiBaseUrl}/api/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border bg-card/50 p-6 hover:border-primary/50 hover:bg-card transition-all"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-terminal-green/10 flex items-center justify-center shrink-0">
                <Braces className="h-6 w-6 text-terminal-green" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-semibold text-lg">Swagger UI</h4>
                  <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">{t("api.swagger")}</p>
                <div className="font-mono text-xs text-terminal-green bg-terminal-green/5 rounded px-2 py-1 inline-block">
                  /api/docs
                </div>
              </div>
            </div>
          </a>

          {/* Redoc */}
          <a
            href={`${apiBaseUrl}/api/redoc`}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border bg-card/50 p-6 hover:border-accent/50 hover:bg-card transition-all"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-terminal-purple/10 flex items-center justify-center shrink-0">
                <FileCode className="h-6 w-6 text-terminal-purple" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-semibold text-lg">Redoc</h4>
                  <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">{t("api.redoc")}</p>
                <div className="font-mono text-xs text-terminal-purple bg-terminal-purple/5 rounded px-2 py-1 inline-block">
                  /api/redoc
                </div>
              </div>
            </div>
          </a>
        </div>

        {/* OpenAPI spec */}
        <div className="rounded-xl border border-border bg-card/50 p-6 mb-6 not-prose">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-12 h-12 rounded-lg bg-terminal-amber/10 flex items-center justify-center shrink-0">
                <FileJson className="h-6 w-6 text-terminal-amber" />
              </div>
              <div>
                <h4 className="font-semibold text-lg mb-1">OpenAPI</h4>
                <p className="text-sm text-muted-foreground">{t("api.openapi")}</p>
              </div>
            </div>
            <a
              href={`${apiBaseUrl}/api/v1/openapi.json`}
              download="gigapdf-openapi.json"
              className="shrink-0"
            >
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                {t("api.download")}
              </Button>
            </a>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto">
              <span className="text-terminal-cyan">GET</span>{" "}
              <span className="text-muted-foreground">{apiBaseUrl}</span>
              <span className="text-foreground">/api/v1/openapi.json</span>
            </div>
          </div>
        </div>

        {/* Example request */}
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose">
          <h3 className="font-semibold mb-2">{t("api.exampleTitle")}</h3>
          <p className="text-sm text-muted-foreground mb-4">{t("api.exampleDescription")}</p>
          <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre">
            <span className="text-terminal-cyan">curl</span> -X POST {apiBaseUrl}/api/v1/documents/upload \{"\n"}
            {"  "}-H <span className="text-terminal-green">&quot;Authorization: Bearer $TOKEN&quot;</span> \{"\n"}
            {"  "}-F <span className="text-terminal-amber">&quot;file=@document.pdf&quot;</span>
          </div>
        </div>
      </section>
    </div>
  );
}
