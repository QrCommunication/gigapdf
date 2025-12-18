"use client";

import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  Briefcase,
  ScrollText,
  CreditCard,
  Settings,
  LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
};

const navigation: NavItem[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "tenants",
    href: "/tenants",
    icon: Building2,
  },
  {
    key: "users",
    href: "/users",
    icon: Users,
  },
  {
    key: "documents",
    href: "/documents",
    icon: FileText,
  },
  {
    key: "jobs",
    href: "/jobs",
    icon: Briefcase,
  },
  {
    key: "logs",
    href: "/logs",
    icon: ScrollText,
  },
  {
    key: "plans",
    href: "/plans",
    icon: CreditCard,
  },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <aside className="fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] w-64 border-r bg-background">
      <nav className="space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
