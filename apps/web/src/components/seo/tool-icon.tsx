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
  Combine,
  FileArchive,
  FileInput,
  FileOutput,
  FileSearch,
  FileSignature,
  FileSpreadsheet,
  FileStack,
  FileText,
  FileType,
  Globe,
  GraduationCap,
  HardHat,
  HeartPulse,
  Highlighter,
  Image,
  Images,
  LayoutGrid,
  Lock,
  Merge,
  PenLine,
  Presentation,
  Scale,
  ScanText,
  Scissors,
  SquarePen,
  Stamp,
  Table,
  Unlock,
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
  combine: Combine,
  "file-archive": FileArchive,
  "file-input": FileInput,
  "file-output": FileOutput,
  "file-search": FileSearch,
  "file-signature": FileSignature,
  "file-spreadsheet": FileSpreadsheet,
  "file-stack": FileStack,
  "file-text": FileText,
  "file-type": FileType,
  globe: Globe,
  "graduation-cap": GraduationCap,
  "hard-hat": HardHat,
  "heart-pulse": HeartPulse,
  highlighter: Highlighter,
  image: Image,
  images: Images,
  "layout-grid": LayoutGrid,
  lock: Lock,
  merge: Merge,
  "pen-line": PenLine,
  presentation: Presentation,
  scale: Scale,
  "scan-text": ScanText,
  scissors: Scissors,
  "square-pen": SquarePen,
  stamp: Stamp,
  table: Table,
  unlock: Unlock,
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
