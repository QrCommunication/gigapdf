"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
  useToast,
} from "@giga-pdf/ui";
import { Loader2, Play } from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";
import { ToolFieldControl } from "./tool-field-control";
import { buildRequestPayload, resolveOutputName } from "./tool-runner-shared";
import type { ToolConfig, ToolTextInput } from "./tool-runner-types";

/**
 * Generic runner for tools whose primary input is text/HTML or a URL rather
 * than an uploaded file (e.g. text→PDF, HTML→PDF). It renders a textarea (or a
 * URL field), the same option {@link ToolFieldControl}s as the file runner,
 * and posts the payload as JSON (or multipart) to {@link ToolConfig.endpoint},
 * downloading the binary response.
 *
 * Every server outcome — success AND failure — is surfaced through the global
 * toaster, as mandated project-wide for any server action.
 */

export interface ToolTextRunnerProps {
  /** A config whose `input` is a {@link ToolTextInput} (text/URL tool). */
  config: ToolConfig & { input: ToolTextInput };
}

export function ToolTextRunner({ config }: ToolTextRunnerProps) {
  const { input } = config;
  const t = useTranslations(config.namespace);
  const tRunner = useTranslations("toolRunner");
  const { toast } = useToast();

  const inputId = useId();
  const [text, setText] = useState("");
  const [outputName, setOutputName] = useState("");
  const [running, setRunning] = useState(false);

  // Option field values, keyed by field name. Initialised from defaults.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of config.fields) {
      if (field.type === "file") continue;
      initial[field.name] =
        field.defaultValue ?? (field.type === "switch" ? "false" : "");
    }
    return initial;
  });

  const setFieldValue = useCallback((name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const trimmedText = text.trim();
  const overLength =
    typeof input.maxLength === "number" && text.length > input.maxLength;

  /** A required option is satisfied when it has a non-empty value. */
  const missingRequired = useMemo(() => {
    return config.fields.some((field) => {
      if (!field.required || field.type === "file") return false;
      return !(fieldValues[field.name] ?? "").trim();
    });
  }, [config.fields, fieldValues]);

  const canRun =
    trimmedText.length > 0 && !running && !overLength && !missingRequired;

  const handleRun = useCallback(async () => {
    if (!canRun) return;

    const finalName = resolveOutputName(config, outputName);
    setRunning(true);
    try {
      const { body, headers } = buildRequestPayload({
        config,
        fieldValues,
        outputName: finalName,
        textValue: trimmedText,
      });

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body,
        credentials: "include",
      });

      if (!response.ok) {
        let message = t("toastError");
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON body — keep the generic localized message.
        }
        toast({ variant: "destructive", title: t("toastError"), description: message });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error(`tool.${config.id}.failed`, err);
      toast({ variant: "destructive", title: t("toastError") });
    } finally {
      setRunning(false);
    }
  }, [canRun, config, fieldValues, outputName, t, toast, trimmedText]);

  const isUrl = input.kind === "url";
  const hintId = `${inputId}-hint`;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5 pt-6">
          {/* Primary text / URL input */}
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t(input.labelKey)}</Label>
            {isUrl ? (
              <Input
                id={inputId}
                type="url"
                inputMode="url"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  input.placeholderKey ? t(input.placeholderKey) : undefined
                }
                disabled={running}
                autoComplete="off"
                aria-describedby={input.descriptionKey ? hintId : undefined}
              />
            ) : (
              <Textarea
                id={inputId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  input.placeholderKey ? t(input.placeholderKey) : undefined
                }
                rows={input.rows ?? 12}
                disabled={running}
                spellCheck={false}
                className="font-mono text-sm"
                aria-describedby={input.descriptionKey ? hintId : undefined}
              />
            )}
            {input.descriptionKey && (
              <p id={hintId} className="text-xs text-muted-foreground">
                {t(input.descriptionKey)}
              </p>
            )}
            {overLength && (
              <p className="text-xs text-destructive" aria-live="polite">
                {tRunner("overLength", { max: input.maxLength ?? 0 })}
              </p>
            )}
          </div>

          {/* Option fields */}
          {config.fields.length > 0 && (
            <div className="space-y-4">
              {config.fields.map((field) => (
                <ToolFieldControl
                  key={field.name}
                  field={field}
                  disabled={running}
                  value={fieldValues[field.name] ?? ""}
                  file={null}
                  onValueChange={setFieldValue}
                  onFileChange={() => undefined}
                  t={t}
                />
              ))}
            </div>
          )}

          {config.allowOutputName && (
            <div className="space-y-1.5">
              <Label htmlFor={`${config.id}-output-name`}>
                {tRunner("outputNameLabel")}
              </Label>
              <Input
                id={`${config.id}-output-name`}
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder={config.defaultOutputName}
                disabled={running}
                autoComplete="off"
              />
            </div>
          )}

          <Button size="lg" onClick={handleRun} disabled={!canRun}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {running ? tRunner("processing") : t("actionButton")}
          </Button>

          {running && (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm text-muted-foreground">
                {tRunner("processingHint")}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
