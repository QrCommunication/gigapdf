"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
  href?: string;
  variant?: "horizontal" | "stacked" | "icon";
}

const sizes = {
  sm: { icon: 24, width: 100, height: 28 },
  md: { icon: 32, width: 140, height: 40 },
  lg: { icon: 48, width: 200, height: 56 },
};

export function Logo({
  className,
  showText = true,
  size = "md",
  href = "/",
  variant = "horizontal"
}: LogoProps) {
  const { width, height, icon } = sizes[size];
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  // Select logo based on variant and theme
  const getLogoSrc = () => {
    if (!showText) {
      return isDark ? "/logo-icon-dark.svg" : "/logo-icon-light.svg";
    }
    if (variant === "stacked") {
      return isDark ? "/logo-stacked-dark.svg" : "/logo-stacked-light.svg";
    }
    return isDark ? "/logo-horizontal-dark.svg" : "/logo-horizontal-light.svg";
  };

  const logoSrc = getLogoSrc();

  const content = (
    <div className={cn("flex items-center gap-2", className)}>
      {showText ? (
        <Image
          src={logoSrc}
          alt="GigaPDF - Éditeur PDF Open Source"
          width={width}
          height={height}
          className="h-auto"
          priority
        />
      ) : (
        <Image
          src={logoSrc}
          alt="GigaPDF"
          width={icon}
          height={icon}
          className="h-auto"
          priority
        />
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="flex items-center">
        {content}
      </Link>
    );
  }

  return content;
}

export function LogoIcon({ className, size = 24 }: { className?: string; size?: number }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const logoSrc = mounted && resolvedTheme === "dark"
    ? "/logo-icon-dark.svg"
    : "/logo-icon-light.svg";

  return (
    <Image
      src={logoSrc}
      alt="GigaPDF"
      width={size}
      height={size}
      className={cn("h-auto", className)}
    />
  );
}
