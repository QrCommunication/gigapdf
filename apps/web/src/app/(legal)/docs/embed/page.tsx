"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft,
  Code2,
  Blocks,
  Shield,
  Zap,
  Settings,
  Copy,
  Check,
  Terminal,
  Layout,
  Key,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";

function CodeBlock({ code, lang: _lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <div className="font-mono text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre">
        {code}
      </div>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copier"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-terminal-green" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

export default function EmbedDocsPage() {
  const t = useTranslations("legal.docs.embed");

  return (
    <div className="max-w-none">
      {/* Back link */}
      <div className="mb-8 not-prose">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToDocs")}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-terminal-purple/30 bg-terminal-purple/5 px-4 py-1.5 text-sm mb-6">
          <Blocks className="h-4 w-4 text-terminal-purple" />
          <span className="font-mono text-terminal-purple">embed-sdk</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          {t("description")}
        </p>
      </div>

      {/* How it works */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("howItWorks.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3 not-prose">
          {[
            { icon: Key, color: "terminal-amber", step: "01" },
            { icon: Code2, color: "terminal-cyan", step: "02" },
            { icon: Layout, color: "terminal-green", step: "03" },
          ].map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card/50 p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-lg bg-${item.color}/10 flex items-center justify-center`}
                >
                  <item.icon className={`h-5 w-5 text-${item.color}`} />
                </div>
                <span
                  className={`font-mono text-sm text-${item.color}`}
                >
                  {item.step}
                </span>
              </div>
              <h3 className="font-semibold mb-1">
                {t(`howItWorks.step${i + 1}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(`howItWorks.step${i + 1}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Installation */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("installation.title")}</h2>
        <div className="space-y-4 not-prose">
          {/* npm */}
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-terminal-green/10 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-terminal-green" />
              </div>
              <div>
                <h3 className="font-semibold">npm / pnpm / yarn</h3>
                <p className="text-sm text-muted-foreground">
                  {t("installation.npm.description")}
                </p>
              </div>
            </div>
            <CodeBlock code="npm install @giga-pdf/embed\n# ou\npnpm add @giga-pdf/embed" />
          </div>

          {/* CDN */}
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-terminal-cyan/10 flex items-center justify-center">
                <Zap className="h-5 w-5 text-terminal-cyan" />
              </div>
              <div>
                <h3 className="font-semibold">CDN</h3>
                <p className="text-sm text-muted-foreground">
                  {t("installation.cdn.description")}
                </p>
              </div>
            </div>
            <CodeBlock
              lang="html"
              code={'<script src="https://cdn.giga-pdf.com/embed.js"></script>'}
            />
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("quickstart.title")}</h2>
        <div className="space-y-6 not-prose">
          {/* CDN Example */}
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-2">
              {t("quickstart.cdn.title")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("quickstart.cdn.description")}
            </p>
            <CodeBlock
              lang="html"
              code={`<div id="pdf-editor"></div>

<script src="https://cdn.giga-pdf.com/embed.js"></script>
<script>
  const editor = GigaPdf.init({
    apiKey: 'giga_pk_your_api_key',
    container: '#pdf-editor',
    height: 700,
    theme: 'light',
  });

  editor.on('ready', () => {
    console.log('Editor is ready!');
  });

  editor.on('save', ({ documentId, pageCount }) => {
    console.log('Saved:', documentId, pageCount + ' pages');
  });
</script>`}
            />
          </div>

          {/* Vanilla JS / ESM */}
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-2">
              {t("quickstart.esm.title")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("quickstart.esm.description")}
            </p>
            <CodeBlock
              lang="typescript"
              code={`import { GigaPdf } from '@giga-pdf/embed';

const editor = GigaPdf.init({
  apiKey: 'giga_pk_your_api_key',
  container: '#pdf-editor',
  documentId: 'doc_abc123',
  locale: 'fr',
  theme: 'light',
  tools: ['text', 'image', 'annotation'],
});

editor.on('ready', () => console.log('Ready'));
editor.on('save', ({ documentId }) => console.log('Saved:', documentId));
editor.on('error', ({ code, message }) => console.error(code, message));

// Trigger actions programmatically
editor.savePdf();
editor.exportPdf('pdf');
editor.loadDocument('doc_xyz456');

// Cleanup when done
editor.destroy();`}
            />
          </div>

          {/* React */}
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="font-semibold mb-2">
              {t("quickstart.react.title")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("quickstart.react.description")}
            </p>
            <CodeBlock
              lang="tsx"
              code={`import { useRef } from 'react';
import { GigaPdfEditor, type GigaPdfEditorRef } from '@giga-pdf/embed/react';

export function PdfEditor() {
  const editorRef = useRef<GigaPdfEditorRef>(null);

  return (
    <div>
      <GigaPdfEditor
        ref={editorRef}
        apiKey="giga_pk_your_api_key"
        documentId="doc_abc123"
        height={700}
        locale="fr"
        theme="light"
        tools={['text', 'image', 'shape', 'annotation']}
        onReady={() => console.log('Editor ready')}
        onSave={({ documentId, pageCount }) =>
          console.log('Saved', documentId, pageCount)
        }
        onError={({ code, message }) =>
          console.error('Error:', code, message)
        }
      />

      <div className="flex gap-2 mt-4">
        <button onClick={() => editorRef.current?.savePdf()}>
          Save
        </button>
        <button onClick={() => editorRef.current?.exportPdf()}>
          Export PDF
        </button>
      </div>
    </div>
  );
}`}
            />
          </div>
        </div>
      </section>

      {/* Configuration Options */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("options.title")}</h2>
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden not-prose">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold">{t("options.option")}</th>
                  <th className="text-left px-4 py-3 font-semibold">{t("options.type")}</th>
                  <th className="text-left px-4 py-3 font-semibold">{t("options.default")}</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { name: "apiKey", type: "string", def: "—", required: true, desc: "apiKey" },
                  { name: "container", type: "HTMLElement | string", def: "—", required: true, desc: "container" },
                  { name: "documentId", type: "string", def: "—", required: false, desc: "documentId" },
                  { name: "baseUrl", type: "string", def: "https://giga-pdf.com", required: false, desc: "baseUrl" },
                  { name: "width", type: "string | number", def: '"100%"', required: false, desc: "width" },
                  { name: "height", type: "string | number", def: '"600px"', required: false, desc: "height" },
                  { name: "locale", type: '"fr" | "en"', def: '"fr"', required: false, desc: "locale" },
                  { name: "theme", type: '"light" | "dark" | "system"', def: '"light"', required: false, desc: "theme" },
                  { name: "hideToolbar", type: "boolean", def: "false", required: false, desc: "hideToolbar" },
                  { name: "tools", type: "string[]", def: "all", required: false, desc: "tools" },
                ].map((opt) => (
                  <tr key={opt.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <code className="text-terminal-cyan font-mono text-xs bg-terminal-cyan/5 px-1.5 py-0.5 rounded">
                        {opt.name}
                      </code>
                      {opt.required && (
                        <span className="ml-2 text-xs text-terminal-amber font-medium">
                          {t("options.required")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {opt.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {opt.def}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t(`options.descriptions.${opt.desc}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Events */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("events.title")}</h2>
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden not-prose">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold">{t("events.event")}</th>
                  <th className="text-left px-4 py-3 font-semibold">Payload</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { name: "ready", payload: "—", desc: "ready" },
                  { name: "save", payload: "{ documentId: string, pageCount: number }", desc: "save" },
                  { name: "export", payload: "{ blob: Blob, format: string }", desc: "export" },
                  { name: "error", payload: "{ code: string, message: string }", desc: "error" },
                  { name: "pageChange", payload: "{ page: number, total: number }", desc: "pageChange" },
                ].map((evt) => (
                  <tr key={evt.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <code className="text-terminal-green font-mono text-xs bg-terminal-green/5 px-1.5 py-0.5 rounded">
                        {evt.name}
                      </code>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {evt.payload}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t(`events.descriptions.${evt.desc}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Methods */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("methods.title")}</h2>
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden not-prose">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold">{t("methods.method")}</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { name: "on(event, callback)", desc: "on" },
                  { name: "off(event, callback)", desc: "off" },
                  { name: "savePdf()", desc: "savePdf" },
                  { name: "exportPdf(format?)", desc: "exportPdf" },
                  { name: "loadDocument(documentId)", desc: "loadDocument" },
                  { name: "destroy()", desc: "destroy" },
                ].map((method) => (
                  <tr key={method.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <code className="text-terminal-purple font-mono text-xs bg-terminal-purple/5 px-1.5 py-0.5 rounded">
                        {method.name}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t(`methods.descriptions.${method.desc}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("security.title")}</h2>
        <div className="space-y-4 not-prose">
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-terminal-amber/10 flex items-center justify-center shrink-0">
                <Key className="h-5 w-5 text-terminal-amber" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">{t("security.apiKeys.title")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("security.apiKeys.description")}
                </p>
                <CodeBlock code={`# ${t("security.apiKeys.createExample")}\ncurl -X POST "https://api.giga-pdf.com/api/v1/api-keys" \\\n  -H "Authorization: Bearer \$JWT_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "My Website", "allowed_domains": ["https://mysite.com"]}'`} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-terminal-green/10 flex items-center justify-center shrink-0">
                <Shield className="h-5 w-5 text-terminal-green" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">{t("security.domains.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("security.domains.description")}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-terminal-cyan/10 flex items-center justify-center shrink-0">
                <Settings className="h-5 w-5 text-terminal-cyan" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">{t("security.scopes.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("security.scopes.description")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Self-hosted */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6">{t("selfHosted.title")}</h2>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose">
          <p className="text-sm text-muted-foreground mb-4">
            {t("selfHosted.description")}
          </p>
          <CodeBlock
            lang="typescript"
            code={`const editor = GigaPdf.init({
  apiKey: 'giga_pk_your_api_key',
  container: '#editor',
  baseUrl: 'https://pdf.your-domain.com', // Your self-hosted instance
});`}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="not-prose">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">{t("cta.title")}</h2>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
            {t("cta.description")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg">{t("cta.signup")}</Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline" size="lg">
                {t("cta.apiDocs")}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
