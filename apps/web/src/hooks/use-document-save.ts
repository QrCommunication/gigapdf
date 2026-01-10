"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

export type SavePriority = "immediate" | "debounced" | "auto";

export interface UseDocumentSaveOptions {
  /** ID du document de session */
  documentId: string | null;
  /** ID du document stocké (pour mise à jour) */
  storedDocumentId?: string | null;
  /** Nom du document */
  name: string;
  /** Dossier de destination */
  folderId?: string | null;
  /** Tags du document */
  tags?: string[];
  /** Document modifié */
  isDirty: boolean;
  /** Callback après sauvegarde réussie */
  onSaved?: (storedDocumentId: string) => void;
  /** Intervalle d'auto-save en ms (0 = désactivé) */
  autoSaveInterval?: number;
  /** Délai de debounce pour les modifications mineures (ms) */
  debounceDelay?: number;
  /** Callback pour marquer comme non modifié */
  setDirty?: (dirty: boolean) => void;
}

export interface UseDocumentSaveReturn {
  /** Sauvegarde en cours */
  saving: boolean;
  /** Erreur de sauvegarde */
  saveError: string | null;
  /** Dernière sauvegarde */
  lastSaved: Date | null;
  /** Sauvegarder maintenant (priorité immédiate) */
  save: () => Promise<boolean>;
  /** Sauvegarder sous (nouveau nom) */
  saveAs: (newName: string, folderId?: string | null) => Promise<boolean>;
  /** Sauvegarder avec priorité (pour actions importantes vs mineures) */
  saveWithPriority: (priority: SavePriority) => void;
  /** Annuler la sauvegarde debounced en attente */
  cancelPendingSave: () => void;
  /** Nombre de modifications en attente */
  pendingChanges: number;
}

/**
 * Hook pour gérer la sauvegarde hybride des documents.
 *
 * Architecture S3 stateless:
 * - Sauvegarde immédiate pour les actions critiques (ajout/suppression d'éléments)
 * - Sauvegarde debounced pour les modifications mineures (position, style)
 * - Auto-save périodique comme filet de sécurité
 *
 * @example
 * const { save, saveWithPriority, saving, lastSaved } = useDocumentSave({
 *   documentId: "abc123",
 *   name: "Mon Document",
 *   isDirty: true,
 *   autoSaveInterval: 30000, // 30 secondes
 *   debounceDelay: 2000, // 2 secondes pour les modifications mineures
 *   onSaved: (id) => console.log("Sauvegardé:", id),
 * });
 *
 * // Action critique (ajout d'élément) -> sauvegarde immédiate
 * saveWithPriority("immediate");
 *
 * // Modification mineure (déplacement) -> sauvegarde debounced
 * saveWithPriority("debounced");
 */
export function useDocumentSave(options: UseDocumentSaveOptions): UseDocumentSaveReturn {
  const {
    documentId,
    storedDocumentId,
    name,
    folderId,
    tags = [],
    isDirty,
    onSaved,
    autoSaveInterval = 30000, // 30 secondes par défaut
    debounceDelay = 2000, // 2 secondes par défaut pour debounce
    setDirty,
  } = options;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);

  // Refs pour éviter les problèmes de closure
  const savingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingChangesRef = useRef(0);

  // Fonction de sauvegarde vers S3
  const performSave = useCallback(
    async (
      saveName: string,
      saveFolderId?: string | null,
      forceNewDocument: boolean = false
    ): Promise<boolean> => {
      if (!documentId || savingRef.current) {
        return false;
      }

      savingRef.current = true;
      setSaving(true);
      setSaveError(null);

      try {
        console.log("[Save] Sauvegarde vers S3...", { documentId, name: saveName });

        let storedId: string;

        if (storedDocumentId && !forceNewDocument) {
          const result = await api.createDocumentVersion(storedDocumentId, {
            document_id: documentId,
            comment: "Mise à jour automatique",
          });
          storedId = result.stored_document_id;
        } else {
          const result = await api.saveDocument({
            document_id: documentId,
            name: saveName,
            folder_id: saveFolderId ?? folderId,
            tags,
          });
          storedId = result.stored_document_id;
        }

        setLastSaved(new Date());
        setPendingChanges(0);
        pendingChangesRef.current = 0;
        setDirty?.(false);
        onSaved?.(storedId);

        console.log("[Save] Sauvegarde réussie:", storedId);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur de sauvegarde";
        setSaveError(message);
        console.error("[Save] Erreur:", err);
        return false;
      } finally {
        setSaving(false);
        savingRef.current = false;
      }
    },
    [documentId, folderId, tags, storedDocumentId, onSaved, setDirty]
  );

  // Sauvegarde avec nom actuel (immédiate)
  const save = useCallback(async () => {
    // Annuler tout debounce en cours
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return performSave(name);
  }, [performSave, name]);

  // Sauvegarde sous (nouveau nom)
  const saveAs = useCallback(
    async (newName: string, newFolderId?: string | null) => {
      // Annuler tout debounce en cours
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return performSave(newName, newFolderId, true);
    },
    [performSave]
  );

  // Sauvegarde avec priorité (hybride)
  const saveWithPriority = useCallback(
    (priority: SavePriority) => {
      // Incrémenter le compteur de modifications
      pendingChangesRef.current += 1;
      setPendingChanges(pendingChangesRef.current);

      switch (priority) {
        case "immediate":
          // Action critique -> sauvegarde immédiate
          console.log("[Save] Action critique - sauvegarde immédiate");
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          save();
          break;

        case "debounced":
          // Modification mineure -> debounce
          console.log("[Save] Modification mineure - debounce", debounceDelay, "ms");
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            console.log("[Save] Debounce terminé - sauvegarde");
            save();
            debounceTimerRef.current = null;
          }, debounceDelay);
          break;

        case "auto":
          // Auto-save - ne fait rien, géré par l'intervalle
          break;
      }
    },
    [save, debounceDelay]
  );

  // Annuler la sauvegarde debounced en attente
  const cancelPendingSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      console.log("[Save] Sauvegarde debounced annulée");
    }
  }, []);

  // Auto-save périodique (filet de sécurité)
  useEffect(() => {
    if (!autoSaveInterval || autoSaveInterval <= 0 || !documentId) {
      return;
    }

    const interval = setInterval(() => {
      // Sauvegarder seulement s'il y a des modifications et pas de sauvegarde en cours
      if (isDirty && !savingRef.current && !debounceTimerRef.current) {
        console.log("[Auto-save] Sauvegarde automatique...");
        save();
      }
    }, autoSaveInterval);

    return () => clearInterval(interval);
  }, [autoSaveInterval, documentId, isDirty, save]);

  // Cleanup du debounce timer au démontage
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Sauvegarde avant fermeture de la page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty || pendingChangesRef.current > 0) {
        e.preventDefault();
        e.returnValue = "Vous avez des modifications non sauvegardées. Voulez-vous vraiment quitter?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  return {
    saving,
    saveError,
    lastSaved,
    save,
    saveAs,
    saveWithPriority,
    cancelPendingSave,
    pendingChanges,
  };
}
