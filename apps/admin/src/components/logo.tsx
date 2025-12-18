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
}

const sizes = {
  sm: { icon: 24, width: 100 },
  md: { icon: 32, width: 140 },
  lg: { icon: 48, width: 200 },
};

export function Logo({ className, showText = true, size = "md", href }: LogoProps) {
  const { width } = sizes[size];
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use light logo as default during SSR to avoid hydration mismatch
  const logoSrc = mounted && resolvedTheme === "dark" ? "/logo-dark.png" : "/logo.png";

  const content = (
    <div className={cn("flex items-center gap-2", className)}>
      {showText ? (
        <Image
          src={logoSrc}
          alt="GigaPDF"
          width={width}
          height={Math.round(width * 0.45)}
          className="h-auto"
          priority
        />
      ) : (
        <Image
          src="/favicon-32x32.png"
          alt="GigaPDF"
          width={sizes[size].icon}
          height={sizes[size].icon}
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
  return (
    <Image
      src="/favicon-32x32.png"
      alt="GigaPDF"
      width={size}
      height={size}
      className={cn("h-auto", className)}
    />
  );
}
