"use client";

import { useTranslations } from "next-intl";
import { ToolIcon } from "@/components/seo/tool-icon";
import { ToolRunner } from "./tool-runner";
import { WatermarkRunner } from "./watermark-runner";
import { getToolConfig, type ToolKey } from "./tools-config";

/**
 * Page shell for a config-driven PDF tool: localized header (icon + title +
 * subtitle) above the generic {@link ToolRunner}. Used by every thin tool
 * page under (app)/(dashboard)/<tool>/page.tsx.
 *
 * `title`/`subtitle` are resolved from the tool's own next-intl namespace
 * (`tools.<id>.title` / `.subtitle`).
 *
 * Most tools are pure config (the generic {@link ToolRunner}). The watermark
 * tool needs a Text | Image mode toggle — two mutually-exclusive option sets
 * the config model can't express — so it renders the bespoke
 * {@link WatermarkRunner} instead. The header stays config-driven.
 */
export function ToolPageShell({ toolKey }: { toolKey: ToolKey }) {
  const config = getToolConfig(toolKey);
  const t = useTranslations(config.namespace);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ToolIcon name={config.icon} className="h-6 w-6 text-primary" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {toolKey === "watermark" ? (
        <WatermarkRunner />
      ) : (
        <ToolRunner config={config} />
      )}
    </div>
  );
}
