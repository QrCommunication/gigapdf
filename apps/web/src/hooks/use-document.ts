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
  /** Ajouter une nouvelle page */
  addPage: () => void;
  /** Supprimer une page */
  deletePage: (pageIndex: number) => void;
  /** Réordonner les pages */
  reorderPages: (fromIndex: number, toIndex: number) => void;
  /** Dupliquer une page */
  duplicatePage: (pageIndex: number) => void;
  /** Mettre à jour le nom du document */
  setName: (name: string) => void;
}

// Génère un ID unique pour les nouvelles pages
function generatePageId(): string {
  return `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  const [documentId, setDocumentId] = useState<string | null>(
    sessionDocumentId || null
  );
  const [storedId, setStoredId] = useState<string | null>(
    storedDocumentId || null
  );
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
          modificationDate:
            (docData.metadata?.modification_date as string) || null,
          pageCount:
            (docData.metadata?.page_count as number) || docData.pages.length,
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
      const message =
        err instanceof Error ? err.message : "Erreur de chargement";
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

  // Ajouter une nouvelle page
  const addPage = useCallback(() => {
    if (!document) return;

    const newPage: PageObject = {
      pageId: generatePageId(),
      pageNumber: document.pages.length + 1,
      dimensions: {
        width: 612, // Letter size in points
        height: 792,
        rotation: 0,
      },
      mediaBox: {
        x: 0,
        y: 0,
        width: 612,
        height: 792,
      },
      cropBox: null,
      elements: [],
      preview: {
        thumbnailUrl: null,
        fullUrl: null,
      },
    };

    const updatedPages = [...document.pages, newPage];

    setDocument({
      ...document,
      pages: updatedPages,
      metadata: {
        ...document.metadata,
        pageCount: updatedPages.length,
      },
    });

    setDirty(true);
    // Naviguer vers la nouvelle page
    setCurrentPageIndex(updatedPages.length - 1);
  }, [document]);

  // Supprimer une page
  const deletePage = useCallback(
    (pageIndex: number) => {
      if (!document || document.pages.length <= 1) return;
      if (pageIndex < 0 || pageIndex >= document.pages.length) return;

      const updatedPages = document.pages
        .filter((_, index) => index !== pageIndex)
        .map((page, index) => ({
          ...page,
          pageNumber: index + 1,
        }));

      setDocument({
        ...document,
        pages: updatedPages,
        metadata: {
          ...document.metadata,
          pageCount: updatedPages.length,
        },
      });

      setDirty(true);

      // Ajuster l'index de la page actuelle si nécessaire
      if (currentPageIndex >= updatedPages.length) {
        setCurrentPageIndex(updatedPages.length - 1);
      } else if (currentPageIndex > pageIndex) {
        setCurrentPageIndex(currentPageIndex - 1);
      }
    },
    [document, currentPageIndex]
  );

  // Réordonner les pages
  const reorderPages = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!document) return;
      if (
        fromIndex < 0 ||
        fromIndex >= document.pages.length ||
        toIndex < 0 ||
        toIndex >= document.pages.length
      ) {
        return;
      }

      const updatedPages = [...document.pages];
      const [movedPage] = updatedPages.splice(fromIndex, 1);
      if (!movedPage) return;
      updatedPages.splice(toIndex, 0, movedPage);

      // Mettre à jour les numéros de page
      const renumberedPages = updatedPages.map((page, index) => ({
        ...page,
        pageNumber: index + 1,
      }));

      setDocument({
        ...document,
        pages: renumberedPages,
      });

      setDirty(true);

      // Ajuster l'index de la page actuelle
      if (currentPageIndex === fromIndex) {
        setCurrentPageIndex(toIndex);
      } else if (fromIndex < currentPageIndex && toIndex >= currentPageIndex) {
        setCurrentPageIndex(currentPageIndex - 1);
      } else if (fromIndex > currentPageIndex && toIndex <= currentPageIndex) {
        setCurrentPageIndex(currentPageIndex + 1);
      }
    },
    [document, currentPageIndex]
  );

  // Dupliquer une page
  const duplicatePage = useCallback(
    (pageIndex: number) => {
      if (!document) return;
      if (pageIndex < 0 || pageIndex >= document.pages.length) return;

      const pageToDuplicate = document.pages[pageIndex];

      // Créer une copie profonde de la page avec un nouvel ID
      const duplicatedPage: PageObject = {
        ...JSON.parse(JSON.stringify(pageToDuplicate)),
        pageId: generatePageId(),
        pageNumber: pageIndex + 2,
        elements: pageToDuplicate.elements.map((element) => ({
          ...element,
          elementId: `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        })),
      };

      // Insérer la page dupliquée après l'originale
      const updatedPages = [
        ...document.pages.slice(0, pageIndex + 1),
        duplicatedPage,
        ...document.pages.slice(pageIndex + 1),
      ].map((page, index) => ({
        ...page,
        pageNumber: index + 1,
      }));

      setDocument({
        ...document,
        pages: updatedPages,
        metadata: {
          ...document.metadata,
          pageCount: updatedPages.length,
        },
      });

      setDirty(true);

      // Naviguer vers la page dupliquée
      setCurrentPageIndex(pageIndex + 1);
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
    addPage,
    deletePage,
    reorderPages,
    duplicatePage,
    setName,
  };
}
