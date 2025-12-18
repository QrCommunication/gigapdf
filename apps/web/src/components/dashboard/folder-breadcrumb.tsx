"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@giga-pdf/ui";
import { Home, ChevronRight } from "lucide-react";
import { DragItem } from "./document-explorer";
import { cn } from "@/lib/utils";

export interface BreadcrumbFolder {
  id: string;
  name: string;
}

interface FolderBreadcrumbProps {
  folders: BreadcrumbFolder[];
  onNavigate: (folderId: string | null) => void;
  draggedItem?: DragItem | null;
  onDrop?: (folderId: string | null) => void;
}

export function FolderBreadcrumb({
  folders,
  onNavigate,
  draggedItem,
  onDrop,
}: FolderBreadcrumbProps) {
  const t = useTranslations("documents.explorer");
  const [dragOverId, setDragOverId] = useState<string | null | "root">(null);

  const handleDragOver = (e: React.DragEvent, id: string | null) => {
    if (!draggedItem) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id === null ? "root" : id);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    onDrop?.(folderId);
  };

  const canDropOnRoot = draggedItem && folders.length > 0;
  const isRootDropTarget = dragOverId === "root" && canDropOnRoot;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {folders.length === 0 ? (
            <BreadcrumbPage className="flex items-center gap-1">
              <Home className="h-4 w-4" />
              {t("root")}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(null);
              }}
              onDragOver={(e) => handleDragOver(e, null)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, null)}
              className={cn(
                "flex items-center gap-1 cursor-pointer px-2 py-1 rounded transition-colors",
                isRootDropTarget && "bg-primary/20 ring-2 ring-primary"
              )}
            >
              <Home className="h-4 w-4" />
              {t("root")}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {folders.flatMap((folder, index) => {
          const isLastFolder = index === folders.length - 1;
          const canDropHere = draggedItem && !isLastFolder;
          const isDropTarget = dragOverId === folder.id && canDropHere;

          return [
            <BreadcrumbSeparator key={`sep-${folder.id}`}>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>,
            <BreadcrumbItem key={folder.id}>
              {isLastFolder ? (
                <BreadcrumbPage>{folder.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(folder.id);
                  }}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder.id)}
                  className={cn(
                    "cursor-pointer px-2 py-1 rounded transition-colors",
                    isDropTarget && "bg-primary/20 ring-2 ring-primary"
                  )}
                >
                  {folder.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>,
          ];
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
