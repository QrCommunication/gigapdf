"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface KeyDisplayProps {
  label: string;
  value: string;
  masked?: boolean;
  className?: string;
}

export function KeyDisplay({ label, value, masked = false, className }: KeyDisplayProps) {
  const t = useTranslations("developers.actions");
  const [copied, setCopied] = useState(false);

  const displayValue = masked ? value : value;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm break-all">
          {displayValue}
        </code>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleCopy}
          title={copied ? t("copied") : t("copy")}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
