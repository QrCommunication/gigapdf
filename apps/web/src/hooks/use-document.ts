"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { DocumentObject, PageObject } from "@giga-pdf/types";

export interface UseDocumentOptions {
  /** ID du document stocké (S3) - si fourni, charge depuis le stockage */
  storedDocumentId?: string;
  /** ID du document de session - si fourni, charge depuis la session */
  sessionDocumentId?: string;
}

export interface UseDocumentReturn {
  /** Document chargé */
  document: DocumentObject | null;
  /** Nom du document */
  name: string;
  /** Pages du document */
  pages: PageObject[];
  /** Page actuelle */
  currentPage: PageObject | null;
  /** Index de la page actuelle (0-based) */
  currentPageIndex: number;
  /** Chargement en cours */
  loading: boolean;
  /** Erreur de chargement */
  error: string | null;
  /** ID du document de session (pour les appels API) */
  documentId: string | null;
  /** ID du document stocké */
  storedDocumentId: string | null;
  /** Naviguer vers une page */
  goToPage: (pageIndex: number) => void;
  /** Recharger le document */
  reload: () => Promise<void>;
  /** Document modifié (non sauvegardé) */
  isDirty: boolean;
  /** Marquer comme modifié */
  setDirty: (dirty: boolean) => void;
}

/**
 * Hook pour charger et gérer un document PDF.
 *
 * @example
 * // Charger un document depuis le stockage S3
 * const { document, pages, loading } = useDocument({ storedDocumentId: "abc123" });
 *
 * @example
 * // Charger un document de session (après upload)
 * const { document, pages } = useDocument({ sessionDocumentId: "xyz789" });
 */
export function useDocument(options: UseDocumentOptions): UseDocumentReturn {
  const { storedDocumentId, sessionDocumentId } = options;

  const [document, setDocument] = useState<DocumentObject | null>(null);
  const [name, setName] = useState<string>("");
  const [documentId, setDocumentId] = useState<string | null>(sessionDocumentId || null);
  const [storedId, setStoredId] = useState<string | null>(storedDocumentId || null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setDirty] = useState(false);

  // Charger le document
  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let docId = sessionDocumentId;
      let docName = "";

      // Si on a un storedDocumentId, charger d'abord depuis S3
      if (storedDocumentId && !sessionDocumentId) {
        const loadResult = await api.loadDocument(storedDocumentId);
        docId = loadResult.document_id;
        docName = loadResult.name;
        setStoredId(storedDocumentId);
      }

      if (!docId) {
        throw new Error("Aucun ID de document fourni");
      }

      setDocumentId(docId);

      // Récupérer le document complet avec pages et éléments
      const docData = await api.getDocument(docId);

      // Convertir les données en types stricts
      const doc: DocumentObject = {
        documentId: docData.document_id,
        metadata: {
          title: (docData.metadata?.title as string) || docName || "Sans titre",
          author: (docData.metadata?.author as string) || null,
          subject: (docData.metadata?.subject as string) || null,
          keywords: (docData.metadata?.keywords as string[]) || [],
          creator: (docData.metadata?.creator as string) || null,
          producer: (docData.metadata?.producer as string) || null,
          creationDate: (docData.metadata?.creation_date as string) || null,
          modificationDate: (docData.metadata?.modification_date as string) || null,
          pageCount: (docData.metadata?.page_count as number) || docData.pages.length,
          pdfVersion: (docData.metadata?.pdf_version as string) || "1.4",
          isEncrypted: (docData.metadata?.is_encrypted as boolean) || false,
          permissions: {
            print: true,
            modify: true,
            copy: true,
            annotate: true,
            fillForms: true,
            extract: true,
            assemble: true,
            printHighQuality: true,
          },
        },
        pages: docData.pages as unknown as PageObject[],
        outlines: [],
        namedDestinations: {},
        embeddedFiles: [],
        layers: [],
      };

      setDocument(doc);
      setName(doc.metadata.title || docName);
      setCurrentPageIndex(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur de chargement";
      setError(message);
      console.error("Erreur chargement document:", err);
    } finally {
      setLoading(false);
    }
  }, [storedDocumentId, sessionDocumentId]);

  // Charger au montage
  useEffect(() => {
    if (storedDocumentId || sessionDocumentId) {
      loadDocument();
    } else {
      setLoading(false);
    }
  }, [storedDocumentId, sessionDocumentId, loadDocument]);

  // Navigation entre pages
  const goToPage = useCallback(
    (pageIndex: number) => {
      if (document && pageIndex >= 0 && pageIndex < document.pages.length) {
        setCurrentPageIndex(pageIndex);
      }
    },
    [document]
  );

  // Pages du document
  const pages = document?.pages || [];
  const currentPage = pages[currentPageIndex] || null;

  return {
    document,
    name,
    pages,
    currentPage,
    currentPageIndex,
    loading,
    error,
    documentId,
    storedDocumentId: storedId,
    goToPage,
    reload: loadDocument,
    isDirty,
    setDirty,
  };
}
