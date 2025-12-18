"use client";

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

export interface BreadcrumbFolder {
  id: string;
  name: string;
}

interface FolderBreadcrumbProps {
  folders: BreadcrumbFolder[];
  onNavigate: (folderId: string | null) => void;
}

export function FolderBreadcrumb({ folders, onNavigate }: FolderBreadcrumbProps) {
  const t = useTranslations("documents.explorer");

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
              className="flex items-center gap-1 cursor-pointer"
            >
              <Home className="h-4 w-4" />
              {t("root")}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {folders.flatMap((folder, index) => [
          <BreadcrumbSeparator key={`sep-${folder.id}`}>
            <ChevronRight className="h-4 w-4" />
          </BreadcrumbSeparator>,
          <BreadcrumbItem key={folder.id}>
            {index === folders.length - 1 ? (
              <BreadcrumbPage>{folder.name}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(folder.id);
                }}
                className="cursor-pointer"
              >
                {folder.name}
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>,
        ])}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
