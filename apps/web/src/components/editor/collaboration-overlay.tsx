"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";

interface CursorInfo {
  userId: string;
  userName: string;
  position: { x: number; y: number };
  pageId?: string;
  color: string;
}

interface CollaboratorInfo {
  id: string;
  name: string;
  avatar?: string;
  color: string;
}

export interface CollaborationOverlayProps {
  /** Curseurs des autres utilisateurs */
  cursors: CursorInfo[];
  /** ID de la page actuellement affichée */
  currentPageId?: string;
  /** Niveau de zoom pour ajuster la position des curseurs */
  zoom: number;
  /** Offset du viewport */
  viewportOffset?: { x: number; y: number };
}

/**
 * Overlay affichant les curseurs des autres utilisateurs
 */
export function CollaborationOverlay({
  cursors,
  currentPageId,
  zoom,
  viewportOffset = { x: 0, y: 0 },
}: CollaborationOverlayProps) {
  // Filtrer les curseurs pour la page actuelle
  const visibleCursors = useMemo(() => {
    return cursors.filter((cursor) => {
      // Si pas de pageId sur le curseur ou pas de page courante, afficher
      if (!cursor.pageId || !currentPageId) return true;
      return cursor.pageId === currentPageId;
    });
  }, [cursors, currentPageId]);

  if (visibleCursors.length === 0) return null;

  return (
    <div className="collaboration-overlay pointer-events-none absolute inset-0 overflow-hidden z-50">
      {visibleCursors.map((cursor) => (
        <UserCursor
          key={cursor.userId}
          cursor={cursor}
          zoom={zoom}
          viewportOffset={viewportOffset}
        />
      ))}
    </div>
  );
}

interface UserCursorProps {
  cursor: CursorInfo;
  zoom: number;
  viewportOffset: { x: number; y: number };
}

function UserCursor({ cursor, zoom, viewportOffset }: UserCursorProps) {
  // Calculer la position avec le zoom et l'offset
  const style = useMemo(() => {
    return {
      left: cursor.position.x * zoom + viewportOffset.x,
      top: cursor.position.y * zoom + viewportOffset.y,
      transform: "translate(-2px, -2px)",
    };
  }, [cursor.position, zoom, viewportOffset]);

  return (
    <div className="absolute transition-all duration-75 ease-out" style={style}>
      {/* Curseur SVG */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
          fill={cursor.color}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>

      {/* Nom de l'utilisateur */}
      <div
        className="absolute left-5 top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
        style={{ backgroundColor: cursor.color }}
      >
        {cursor.userName}
      </div>
    </div>
  );
}

export interface CollaboratorsListProps {
  /** Liste des collaborateurs connectés */
  collaborators: CollaboratorInfo[];
  /** Nombre maximum à afficher avant de réduire */
  maxVisible?: number;
}

/**
 * Liste des collaborateurs connectés (avatars)
 */
export function CollaboratorsList({
  collaborators,
  maxVisible = 4,
}: CollaboratorsListProps) {
  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const remainingCount = Math.max(0, collaborators.length - maxVisible);

  if (collaborators.length === 0) return null;

  return (
    <div className="collaborators-list flex items-center -space-x-2">
      {visibleCollaborators.map((collaborator) => (
        <div
          key={collaborator.id}
          className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-medium text-white shadow-sm transition-transform hover:scale-110 hover:z-10"
          style={{ backgroundColor: collaborator.color }}
          title={collaborator.name}
        >
          {collaborator.avatar ? (
            <img
              src={collaborator.avatar}
              alt={collaborator.name}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span>{getInitials(collaborator.name)}</span>
          )}

          {/* Indicateur de présence */}
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
        </div>
      ))}

      {remainingCount > 0 && (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground shadow-sm"
          title={`+${remainingCount} more`}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}

/**
 * Obtenir les initiales d'un nom
 */
function getInitials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export interface CollaborationStatusProps {
  /** WebSocket connecté */
  isConnected: boolean;
  /** Nombre de collaborateurs */
  collaboratorCount: number;
}

/**
 * Indicateur de statut de la collaboration
 */
export function CollaborationStatus({
  isConnected,
  collaboratorCount,
}: CollaborationStatusProps) {
  const t = useTranslations("editor");

  return (
    <div className="collaboration-status flex items-center gap-2 text-xs text-muted-foreground">
      {/* Indicateur de connexion */}
      <span
        className={`h-2 w-2 rounded-full ${
          isConnected ? "bg-green-500" : "bg-red-500"
        }`}
        title={isConnected ? "Connected" : "Disconnected"}
      />

      {/* Compteur de collaborateurs */}
      <span>{t("collaborators", { count: collaboratorCount })}</span>
    </div>
  );
}
