"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { offlineQueue, type PendingOperation } from "@/lib/offline-queue";
import { useLogger } from "@giga-pdf/logger";

// ---------------------------------------------------------------------------
// PDF Blob retrieval — downloads the current PDF bytes from the session
// ---------------------------------------------------------------------------

/**
 * Fetches the raw PDF bytes for a session document as a Blob.
 *
 * Error handling:
 * - 401 → throws, triggering re-authentication in the calling hook
 * - 404 → throws with a descriptive message ("document not found")
 * - Other non-OK status → throws with the HTTP status code
 */
async function fetchPdfBlobForSave(documentId: string): Promise<Blob> {
  const { getAuthToken } = await import("@/lib/api");
  const token = await getAuthToken();
  const response = await fetch(`/api/v1/documents/${documentId}/download`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Unauthorized: session expired, please sign in again");
    }
    if (response.status === 404) {
      throw new Error(`Document not found: ${documentId}`);
    }
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  return response.blob();
}

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
  /** Appareil actuellement hors ligne */
  isOffline: boolean;
  /** Synchronisation de la queue offline en cours */
  isSyncing: boolean;
  /** Nombre d'opérations en attente dans la queue offline */
  offlineQueueSize: number;
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

  const logger = useLogger({ component: 'useDocumentSave' });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);

  // Refs pour éviter les problèmes de closure
  const savingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingChangesRef = useRef(0);
  const isOfflineRef = useRef(isOffline);
  const isSyncingRef = useRef(false);

  // Maintenir isOfflineRef synchronisé avec l'état React
  useEffect(() => {
    isOfflineRef.current = isOffline;
  }, [isOffline]);

  // --------------------------------------------------------------------------
  // Helpers queue offline
  // --------------------------------------------------------------------------

  const refreshQueueSize = useCallback(async () => {
    const size = await offlineQueue.size();
    setOfflineQueueSize(size);
  }, []);

  // --------------------------------------------------------------------------
  // Fonction de sauvegarde vers S3 (online path)
  // --------------------------------------------------------------------------

  const performSave = useCallback(
    async (
      saveName: string,
      saveFolderId?: string | null,
      forceNewDocument: boolean = false
    ): Promise<boolean> => {
      if (!documentId || savingRef.current) {
        return false;
      }

      // Si hors ligne : enqueue l'opération et retourner immédiatement
      if (isOfflineRef.current) {
        await offlineQueue.enqueue({
          type: 'save_document',
          payload: {
            documentId,
            storedDocumentId: storedDocumentId ?? null,
            name: saveName,
            folderId: saveFolderId ?? folderId ?? null,
            tags,
            forceNewDocument,
          },
        });
        await refreshQueueSize();
        logger.info('Document queued for offline sync', { documentId, saveName });
        return true;
      }

      savingRef.current = true;
      setSaving(true);
      setSaveError(null);

      try {
        logger.info('Saving document to S3', { documentId, name: saveName });

        // Fetch PDF bytes before calling the multipart API
        const pdfBlob = await fetchPdfBlobForSave(documentId);

        let storedId: string;

        if (storedDocumentId && !forceNewDocument) {
          const result = await api.createDocumentVersion(storedDocumentId, {
            file: pdfBlob,
            comment: "Mise à jour automatique",
          });
          storedId = result.stored_document_id;
        } else {
          const result = await api.saveDocument({
            file: pdfBlob,
            name: saveName,
            folderId: (saveFolderId ?? folderId) ?? undefined,
            tags,
          });
          storedId = result.stored_document_id;
        }

        setLastSaved(new Date());
        setPendingChanges(0);
        pendingChangesRef.current = 0;
        setDirty?.(false);
        onSaved?.(storedId);

        logger.info('Document saved successfully', { storedId });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur de sauvegarde";
        setSaveError(message);
        logger.error('Save failed', { documentId, errorMessage: message });

        // Enqueue en cas d'erreur réseau (connexion perdue pendant la requête)
        await offlineQueue.enqueue({
          type: 'save_document',
          payload: {
            documentId,
            storedDocumentId: storedDocumentId ?? null,
            name: saveName,
            folderId: saveFolderId ?? folderId ?? null,
            tags,
            forceNewDocument,
          },
        });
        await refreshQueueSize();
        logger.warn('Document queued after save error', { documentId });

        return false;
      } finally {
        setSaving(false);
        savingRef.current = false;
      }
    },
    [documentId, folderId, tags, storedDocumentId, onSaved, setDirty, logger, refreshQueueSize]
  );

  // --------------------------------------------------------------------------
  // Handler de replay pour le flush offline
  // --------------------------------------------------------------------------

  const replayOperation = useCallback(
    async (op: PendingOperation): Promise<void> => {
      if (op.type !== 'save_document') {
        logger.warn('Unknown op type during replay, skipping', { opType: op.type });
        return;
      }

      const {
        documentId: opDocId,
        storedDocumentId: opStoredId,
        name: opName,
        folderId: opFolderId,
        tags: opTags,
        forceNewDocument,
      } = op.payload as {
        documentId: string;
        storedDocumentId: string | null;
        name: string;
        folderId: string | null;
        tags: string[];
        forceNewDocument: boolean;
      };

      // Re-fetch PDF bytes at replay time — Blobs cannot be persisted in IndexedDB
      const pdfBlob = await fetchPdfBlobForSave(opDocId);

      if (opStoredId && !forceNewDocument) {
        await api.createDocumentVersion(opStoredId, {
          file: pdfBlob,
          comment: "Synchronisation offline",
        });
      } else {
        const result = await api.saveDocument({
          file: pdfBlob,
          name: opName,
          folderId: opFolderId ?? undefined,
          tags: opTags,
        });
        onSaved?.(result.stored_document_id);
      }
    },
    [onSaved, logger]
  );

  // --------------------------------------------------------------------------
  // Flush de la queue au retour en ligne
  // --------------------------------------------------------------------------

  const flushOfflineQueue = useCallback(async () => {
    const size = await offlineQueue.size();
    if (size === 0 || isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    logger.info('Flushing offline queue', { pendingOps: size });

    try {
      const synced = await offlineQueue.flush(replayOperation);
      logger.info('Offline queue flushed', { syncedOps: synced });

      if (synced > 0) {
        setLastSaved(new Date());
        setPendingChanges(0);
        pendingChangesRef.current = 0;
        setDirty?.(false);
      }
    } catch (err) {
      logger.error('Offline queue flush error', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      await refreshQueueSize();
    }
  }, [replayOperation, setDirty, logger, refreshQueueSize]);

  // --------------------------------------------------------------------------
  // Listeners online / offline
  // --------------------------------------------------------------------------

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      logger.info('Connection restored, starting offline sync');
      flushOfflineQueue();
    };

    const handleOffline = () => {
      setIsOffline(true);
      logger.warn('Connection lost, entering offline mode');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushOfflineQueue, logger]);

  // Initialiser la taille de la queue au montage
  useEffect(() => {
    refreshQueueSize();
  }, [refreshQueueSize]);

  // --------------------------------------------------------------------------
  // API publique : save / saveAs / saveWithPriority / cancelPendingSave
  // --------------------------------------------------------------------------

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
          logger.debug('Immediate save triggered');
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          save();
          break;

        case "debounced":
          // Modification mineure -> debounce
          logger.debug('Debounced save scheduled', { debounceDelayMs: debounceDelay });
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            logger.debug('Debounce timer fired, saving');
            save();
            debounceTimerRef.current = null;
          }, debounceDelay);
          break;

        case "auto":
          // Auto-save - ne fait rien, géré par l'intervalle
          break;
      }
    },
    [save, debounceDelay, logger]
  );

  // Annuler la sauvegarde debounced en attente
  const cancelPendingSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      logger.debug('Pending debounced save cancelled');
    }
  }, [logger]);

  // --------------------------------------------------------------------------
  // Auto-save périodique (filet de sécurité)
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!autoSaveInterval || autoSaveInterval <= 0 || !documentId) {
      return;
    }

    const interval = setInterval(() => {
      // Sauvegarder seulement s'il y a des modifications et pas de sauvegarde en cours
      if (isDirty && !savingRef.current && !debounceTimerRef.current) {
        logger.debug('Auto-save triggered');
        save();
      }
    }, autoSaveInterval);

    return () => clearInterval(interval);
  }, [autoSaveInterval, documentId, isDirty, save, logger]);

  // --------------------------------------------------------------------------
  // Cleanup du debounce timer au démontage
  // --------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // beforeunload : avertir si queue non-vide ou modifications en attente
  // --------------------------------------------------------------------------

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasLocalChanges = isDirty || pendingChangesRef.current > 0;
      // Vérification synchrone de la taille mémoire de la queue (IDB async non dispo ici)
      const hasQueuedOps = offlineQueueSize > 0;

      if (hasLocalChanges || hasQueuedOps) {
        e.preventDefault();
        e.returnValue = "Vous avez des modifications non sauvegardées. Voulez-vous vraiment quitter?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, offlineQueueSize]);

  return {
    saving,
    saveError,
    lastSaved,
    save,
    saveAs,
    saveWithPriority,
    cancelPendingSave,
    pendingChanges,
    isOffline,
    isSyncing,
    offlineQueueSize,
  };
}
