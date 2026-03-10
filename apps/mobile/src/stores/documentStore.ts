/**
 * Document Store
 * Zustand store pour gérer l'état des documents
 */

import { create } from 'zustand';
import type { Document, DocumentFilter, Folder } from '../types';

interface DocumentState {
  // État
  documents: Document[];
  currentDocument: Document | null;
  folders: Folder[];
  currentFolder: Folder | null;
  filter: DocumentFilter;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;

  // Actions - Documents
  setDocuments: (documents: Document[]) => void;
  addDocument: (document: Document) => void;
  updateDocument: (id: string, data: Partial<Document>) => void;
  removeDocument: (id: string) => void;
  setCurrentDocument: (document: Document | null) => void;
  toggleFavorite: (id: string) => void;

  // Actions - Folders
  setFolders: (folders: Folder[]) => void;
  addFolder: (folder: Folder) => void;
  updateFolder: (id: string, data: Partial<Folder>) => void;
  removeFolder: (id: string) => void;
  setCurrentFolder: (folder: Folder | null) => void;

  // Actions - Filter
  setFilter: (filter: Partial<DocumentFilter>) => void;
  resetFilter: () => void;

  // Actions - État
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setUploadProgress: (progress: number) => void;
  clearError: () => void;
}

const initialFilter: DocumentFilter = {
  search: '',
  is_favorite: false,
  is_trashed: false,
  sort_by: 'updated_at',
  sort_order: 'desc',
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  // État initial
  documents: [],
  currentDocument: null,
  folders: [],
  currentFolder: null,
  filter: initialFilter,
  isLoading: false,
  error: null,
  uploadProgress: 0,

  // Documents
  setDocuments: (documents: Document[]) => {
    set({ documents });
  },

  addDocument: (document: Document) => {
    set((state) => ({
      documents: [document, ...state.documents],
    }));
  },

  updateDocument: (id: string, data: Partial<Document>) => {
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, ...data } : doc
      ),
      currentDocument:
        state.currentDocument?.id === id
          ? { ...state.currentDocument, ...data }
          : state.currentDocument,
    }));
  },

  removeDocument: (id: string) => {
    set((state) => ({
      documents: state.documents.filter((doc) => doc.id !== id),
      currentDocument:
        state.currentDocument?.id === id ? null : state.currentDocument,
    }));
  },

  setCurrentDocument: (document: Document | null) => {
    set({ currentDocument: document });
  },

  toggleFavorite: (id: string) => {
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, is_favorite: !doc.is_favorite } : doc
      ),
      currentDocument:
        state.currentDocument?.id === id
          ? { ...state.currentDocument, is_favorite: !state.currentDocument.is_favorite }
          : state.currentDocument,
    }));
  },

  // Folders
  setFolders: (folders: Folder[]) => {
    set({ folders });
  },

  addFolder: (folder: Folder) => {
    set((state) => ({
      folders: [...state.folders, folder],
    }));
  },

  updateFolder: (id: string, data: Partial<Folder>) => {
    set((state) => ({
      folders: state.folders.map((folder) =>
        folder.id === id ? { ...folder, ...data } : folder
      ),
      currentFolder:
        state.currentFolder?.id === id
          ? { ...state.currentFolder, ...data }
          : state.currentFolder,
    }));
  },

  removeFolder: (id: string) => {
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== id),
      currentFolder:
        state.currentFolder?.id === id ? null : state.currentFolder,
    }));
  },

  setCurrentFolder: (folder: Folder | null) => {
    set({ currentFolder: folder });
  },

  // Filter
  setFilter: (filter: Partial<DocumentFilter>) => {
    set((state) => ({
      filter: { ...state.filter, ...filter },
    }));
  },

  resetFilter: () => {
    set({ filter: initialFilter });
  },

  // État
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setUploadProgress: (progress: number) => {
    set({ uploadProgress: progress });
  },

  clearError: () => {
    set({ error: null });
  },
}));
