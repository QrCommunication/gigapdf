"use client";

import { useTranslations } from "next-intl";
import { History, Sparkles, Bug, Wrench, Zap, Package, Shield, Globe } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  changes: {
    type: "feature" | "fix" | "improvement" | "security";
    description: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.3.0",
    date: "2026-06-13",
    type: "minor",
    changes: [
      { type: "feature", description: "The public site is now available in English under /en/* — French stays the default with unchanged URLs" },
      { type: "feature", description: "32 new guide pages in French and English: 20 PDF tools (edit, merge, compress, sign, OCR…) and 10 professions, with localized URLs" },
      { type: "feature", description: "Redesigned home page with a 'print-shop editorial' look: crop marks, scroll ruler, numbered sections and subtle animations" },
      { type: "feature", description: "Pro canvas navigation: scroll naturally while zoomed, Ctrl+wheel zooms to your cursor, presets from 50% to 400%, Fit page / Fit width (Ctrl+0 / Ctrl+1), pan with Space or middle-click" },
      { type: "feature", description: "Pro form designer: multiline text, dates, radio groups and dropdowns with editable options; required fields, defaults and max length; Design/Fill modes with highlighting of existing fields; tab-order reordering and flattening after filling" },
      { type: "improvement", description: "Honest pricing: every feature on every plan, including free — you pay for volumes, not features" },
      { type: "fix", description: "Signing up with Google no longer fails with 'unable_to_create_user'" },
      { type: "fix", description: "Plan quotas are now consistent everywhere, and unlimited plans are truly unlimited" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-13",
    type: "minor",
    changes: [
      { type: "feature", description: "Trash: deleted documents can now be restored for 30 days before being permanently removed" },
      { type: "feature", description: "Tags on documents, with filtering and autocomplete from your existing tags" },
      { type: "feature", description: "Full-text search across document names and their content" },
      { type: "feature", description: "Real document thumbnails in your library, generated at upload and refreshed after editing" },
      { type: "feature", description: "Import Word, Excel, PowerPoint and OpenDocument files (.doc, .docx, .xls, .xlsx, .ppt, .pptx, .odt, .ods, .odp) — converted to PDF automatically" },
      { type: "feature", description: "Real-time collaboration: edits from other participants now appear live on the canvas" },
      { type: "feature", description: "Digital signature (PKCS#7) with your own P12/PFX certificate — processed in memory, never stored" },
      { type: "feature", description: "PDF compression with the space saved shown before you apply it" },
      { type: "feature", description: "Searchable PDF: OCR adds an invisible text layer to scanned documents so their text can be selected and searched" },
      { type: "feature", description: "Layers panel: show, hide and lock individual elements" },
      { type: "feature", description: "Multi-selection editing: change opacity, colors and alignment of several elements at once" },
      { type: "feature", description: "Export to ODT and ODP, alongside DOCX, XLSX and PPTX" },
      { type: "improvement", description: "Document duplication, folder renaming, parallel uploads (3 at a time) and an activity history on the document page" },
      { type: "fix", description: "Self-hosted: database migrations could be silently skipped on existing installs — fixed. Run 'alembic upgrade head' after updating" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-12",
    type: "minor",
    changes: [
      { type: "feature", description: "Faithful fonts: the editor identifies the PDF's fonts and downloads the matching Google Font on demand — through our server, never from your browser (GDPR-friendly). The font is embedded in the saved PDF." },
      { type: "feature", description: "Real text formatting in the editor: bold, italic, underline and alignment" },
      { type: "feature", description: "New text automatically uses the document's dominant font" },
      { type: "feature", description: "Watermark can now be applied to the whole document at once" },
      { type: "feature", description: "Share button directly in the editor" },
      { type: "feature", description: "Document detail page with preview, metadata, version history and one-click restore" },
      { type: "improvement", description: "Unified toast notifications across the app" },
      { type: "improvement", description: "Self-host Docker images now ship every PDF dependency out of the box (Office conversions, font fidelity, OCR, HTML to PDF)" },
      { type: "fix", description: "Folder deletion now works from the documents list view" },
      { type: "fix", description: "Added missing translations" },
    ],
  },
  {
    version: "1.0.0",
    date: "2025-01-15",
    type: "major",
    changes: [
      { type: "feature", description: "Initial public release" },
      { type: "feature", description: "WYSIWYG PDF editor with canvas-based editing" },
      { type: "feature", description: "Real-time collaboration via WebSocket" },
      { type: "feature", description: "REST API with OpenAPI documentation" },
      { type: "feature", description: "Multi-tenant organizations with shared quotas" },
      { type: "feature", description: "Stripe billing integration" },
      { type: "feature", description: "OCR text extraction (Tesseract)" },
      { type: "feature", description: "Export to PNG, JPEG, DOCX, HTML" },
      { type: "feature", description: "S3-compatible storage (Scaleway, AWS, MinIO)" },
      { type: "security", description: "JWT RS256 authentication via BetterAuth" },
    ],
  },
  {
    version: "0.9.0",
    date: "2025-01-10",
    type: "minor",
    changes: [
      { type: "feature", description: "Document sharing via email invitations" },
      { type: "feature", description: "Public link sharing with expiration" },
      { type: "improvement", description: "Improved canvas rendering performance" },
      { type: "fix", description: "Fixed Safari canvas rendering issues" },
      { type: "fix", description: "Fixed memory leak in WebSocket connections" },
    ],
  },
  {
    version: "0.8.0",
    date: "2025-01-05",
    type: "minor",
    changes: [
      { type: "feature", description: "Folder organization for documents" },
      { type: "feature", description: "Drag and drop file upload" },
      { type: "feature", description: "Bulk document operations" },
      { type: "improvement", description: "Redesigned document explorer UI" },
      { type: "fix", description: "Fixed PDF merge ordering issue" },
    ],
  },
  {
    version: "0.7.0",
    date: "2024-12-28",
    type: "minor",
    changes: [
      { type: "feature", description: "Admin dashboard for system management" },
      { type: "feature", description: "User management and role assignment" },
      { type: "feature", description: "System health monitoring" },
      { type: "security", description: "Rate limiting and API quotas" },
    ],
  },
  {
    version: "0.6.0",
    date: "2024-12-20",
    type: "minor",
    changes: [
      { type: "feature", description: "Shape tools (rectangle, circle, arrow, line)" },
      { type: "feature", description: "Text annotations and comments" },
      { type: "feature", description: "Freehand drawing tool" },
      { type: "improvement", description: "Better touch support for mobile" },
    ],
  },
  {
    version: "0.5.0",
    date: "2024-12-15",
    type: "minor",
    changes: [
      { type: "feature", description: "Page operations (add, delete, reorder, rotate)" },
      { type: "feature", description: "Document merge and split" },
      { type: "feature", description: "Page thumbnail navigation" },
      { type: "fix", description: "Fixed page rotation persistence" },
    ],
  },
];

const typeConfig = {
  feature: { icon: Sparkles, color: "terminal-green", label: "New" },
  fix: { icon: Bug, color: "terminal-amber", label: "Fix" },
  improvement: { icon: Zap, color: "terminal-cyan", label: "Improved" },
  security: { icon: Shield, color: "terminal-purple", label: "Security" },
};

const versionTypeConfig = {
  major: { color: "primary", label: "Major Release" },
  minor: { color: "accent", label: "Minor Release" },
  patch: { color: "muted-foreground", label: "Patch" },
};

export default function ChangelogContent() {
  const t = useTranslations("legal.changelog");

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-terminal-amber/30 bg-terminal-amber/5 px-4 py-1.5 text-sm mb-6">
          <History className="h-4 w-4 text-terminal-amber" />
          <span className="font-mono text-terminal-amber">changelog</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          {t("description")}
        </p>
      </div>

      {/* Changelog entries */}
      <div className="space-y-12 not-prose">
        {changelog.map((entry, index) => (
          <article key={entry.version} className="relative">
            {/* Version header */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="flex items-center gap-2">
                <Package className={`h-5 w-5 text-${versionTypeConfig[entry.type].color}`} />
                <span className="font-mono text-2xl font-bold">v{entry.version}</span>
              </div>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full bg-${versionTypeConfig[entry.type].color}/10 text-${versionTypeConfig[entry.type].color}`}>
                {versionTypeConfig[entry.type].label}
              </span>
              <span className="text-sm text-muted-foreground font-mono">
                {entry.date}
              </span>
            </div>

            {/* Changes list */}
            <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
              {entry.changes.map((change, changeIndex) => {
                const config = typeConfig[change.type];
                const Icon = config.icon;
                return (
                  <div
                    key={changeIndex}
                    className={`flex items-start gap-4 p-4 ${
                      changeIndex !== entry.changes.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className={`flex items-center gap-2 shrink-0 w-24`}>
                      <Icon className={`h-4 w-4 text-${config.color}`} />
                      <span className={`text-xs font-mono text-${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <span className="text-sm">{change.description}</span>
                  </div>
                );
              })}
            </div>

            {/* Connector line */}
            {index !== changelog.length - 1 && (
              <div className="absolute left-[11px] top-[60px] bottom-[-48px] w-px bg-border" />
            )}
          </article>
        ))}
      </div>

      {/* Subscribe section */}
      <section className="mt-16 rounded-xl border border-border bg-card/50 p-8 not-prose">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">{t("subscribe.title")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("subscribe.description")}
            </p>
            <a
              href="https://github.com/QrCommunication/gigapdf/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              {t("subscribe.link")}
              <Wrench className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
