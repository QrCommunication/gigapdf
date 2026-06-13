/**
 * Mapping nom d'icône (string des fichiers de données SEO) → composant lucide.
 * Garde les fichiers lib/seo/*-data.ts purs (aucune dépendance React).
 */

import {
  Archive,
  BookOpen,
  Briefcase,
  Building,
  Calculator,
  ClipboardList,
  FileArchive,
  FileInput,
  FileOutput,
  FileSearch,
  FileSignature,
  FileSpreadsheet,
  FileStack,
  FileText,
  Globe,
  GraduationCap,
  HardHat,
  HeartPulse,
  Highlighter,
  LayoutGrid,
  Lock,
  Merge,
  PenLine,
  Presentation,
  Scale,
  ScanText,
  Scissors,
  Stamp,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  archive: Archive,
  "book-open": BookOpen,
  briefcase: Briefcase,
  building: Building,
  calculator: Calculator,
  "clipboard-list": ClipboardList,
  "file-archive": FileArchive,
  "file-input": FileInput,
  "file-output": FileOutput,
  "file-search": FileSearch,
  "file-signature": FileSignature,
  "file-spreadsheet": FileSpreadsheet,
  "file-stack": FileStack,
  "file-text": FileText,
  globe: Globe,
  "graduation-cap": GraduationCap,
  "hard-hat": HardHat,
  "heart-pulse": HeartPulse,
  highlighter: Highlighter,
  "layout-grid": LayoutGrid,
  lock: Lock,
  merge: Merge,
  "pen-line": PenLine,
  presentation: Presentation,
  scale: Scale,
  "scan-text": ScanText,
  scissors: Scissors,
  stamp: Stamp,
  users: Users,
  "users-round": UsersRound,
};

interface ToolIconProps {
  name: string;
  className?: string;
}

export function ToolIcon({ name, className }: ToolIconProps) {
  const Icon = ICON_MAP[name] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}
