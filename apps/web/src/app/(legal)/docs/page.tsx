"use client";

import { useTranslations } from "next-intl";
import { BookOpen, FileJson, ExternalLink, Download, Braces, FileCode } from "lucide-react";
import { Button } from "@giga-pdf/ui";

export default function DocsPage() {
  const t = useTranslations("legal.docs");

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "https://giga-pdf.com";

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-terminal-cyan/30 bg-terminal-cyan/5 px-4 py-1.5 text-sm mb-6">
          <BookOpen className="h-4 w-4 text-terminal-cyan" />
          <span className="font-mono text-terminal-cyan">api-documentation</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          {t("description")}
        </p>
      </div>

      {/* Interactive Documentation */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("interactive.title")}</h2>
        <div className="grid gap-6 md:grid-cols-2 not-prose">
          {/* Swagger UI Card */}
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
                  <h3 className="font-semibold text-lg">Swagger UI</h3>
                  <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("interactive.swagger.description")}
                </p>
                <div className="font-mono text-xs text-terminal-green bg-terminal-green/5 rounded px-2 py-1 inline-block">
                  /api/docs
                </div>
              </div>
            </div>
          </a>

          {/* ReDoc Card */}
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
                  <h3 className="font-semibold text-lg">ReDoc</h3>
                  <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("interactive.redoc.description")}
                </p>
                <div className="font-mono text-xs text-terminal-purple bg-terminal-purple/5 rounded px-2 py-1 inline-block">
                  /api/redoc
                </div>
              </div>
            </div>
          </a>
        </div>
      </section>

      {/* OpenAPI Specification */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("openapi.title")}</h2>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-12 h-12 rounded-lg bg-terminal-amber/10 flex items-center justify-center shrink-0">
                <FileJson className="h-6 w-6 text-terminal-amber" />
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1">OpenAPI 3.0 Specification</h3>
                <p className="text-sm text-muted-foreground">
                  {t("openapi.description")}
                </p>
              </div>
            </div>
            <a
              href={`${apiBaseUrl}/api/v1/openapi.json`}
              download="gigapdf-openapi.json"
              className="shrink-0"
            >
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                {t("openapi.download")}
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
      </section>

      {/* Quick Start */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("quickstart.title")}</h2>
        <div className="space-y-4 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-3">{t("quickstart.auth.title")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("quickstart.auth.description")}
            </p>
            <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto">
              <span className="text-terminal-purple">Authorization:</span>{" "}
              <span className="text-terminal-green">Bearer</span>{" "}
              <span className="text-muted-foreground">&lt;your-jwt-token&gt;</span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-3">{t("quickstart.example.title")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("quickstart.example.description")}
            </p>
            <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre">
<span className="text-terminal-cyan">curl</span> -X POST {apiBaseUrl}/api/v1/documents/upload \
  -H <span className="text-terminal-green">"Authorization: Bearer $TOKEN"</span> \
  -F <span className="text-terminal-amber">"file=@document.pdf"</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("features.title")}</h2>
        <div className="grid gap-4 md:grid-cols-2 not-prose">
          {[
            { key: "documents", color: "terminal-green" },
            { key: "pages", color: "terminal-cyan" },
            { key: "elements", color: "terminal-amber" },
            { key: "export", color: "terminal-purple" },
            { key: "ocr", color: "primary" },
            { key: "realtime", color: "accent" },
          ].map((feature, index) => (
            <div
              key={feature.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4"
            >
              <span className={`text-${feature.color} font-mono text-sm`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{t(`features.${feature.key}`)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
