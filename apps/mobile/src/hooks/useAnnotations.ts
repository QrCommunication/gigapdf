/**
 * useAnnotations Hook
 * Manages annotation state with undo/redo functionality
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Annotation,
  EditorTool,
  EditorState,
  defaultEditorState,
} from '../types/annotations';

const generateId = () => `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export interface UseAnnotationsResult {
  annotations: Annotation[];
  activeTool: EditorTool;
  activeColor: string;
  strokeWidth: number;
  fontSize: number;
  opacity: number;
  selectedAnnotationId: string | null;
  isModified: boolean;
  canUndo: boolean;
  canRedo: boolean;

  setActiveTool: (tool: EditorTool) => void;
  setActiveColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setFontSize: (size: number) => void;
  setOpacity: (opacity: number) => void;
  setSelectedAnnotationId: (id: string | null) => void;

  addAnnotation: (annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  clearAnnotations: () => void;

  undo: () => void;
  redo: () => void;

  loadAnnotations: (annotations: Annotation[]) => void;
  exportAnnotations: () => Annotation[];
  resetModified: () => void;
}

export const useAnnotations = (
  initialAnnotations: Annotation[] = []
): UseAnnotationsResult => {
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);

  const [activeTool, setActiveTool] = useState<EditorTool>(defaultEditorState.activeTool);
  const [activeColor, setActiveColor] = useState(defaultEditorState.activeColor);
  const [strokeWidth, setStrokeWidth] = useState(defaultEditorState.strokeWidth);
  const [fontSize, setFontSize] = useState(defaultEditorState.fontSize);
  const [opacity, setOpacity] = useState(defaultEditorState.opacity);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isModified, setIsModified] = useState(false);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  // Push current state to undo stack
  const pushToUndoStack = useCallback((currentAnnotations: Annotation[]) => {
    setUndoStack((prev) => [...prev, currentAnnotations]);
    setRedoStack([]); // Clear redo stack on new action
    setIsModified(true);
  }, []);

  // Add a new annotation
  const addAnnotation = useCallback(
    (annotationData: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const newAnnotation: Annotation = {
        ...annotationData,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      } as Annotation;

      setAnnotations((prev) => {
        pushToUndoStack(prev);
        return [...prev, newAnnotation];
      });
    },
    [pushToUndoStack]
  );

  // Update an existing annotation
  const updateAnnotation = useCallback(
    (id: string, updates: Partial<Annotation>) => {
      setAnnotations((prev) => {
        const index = prev.findIndex((a) => a.id === id);
        if (index === -1) return prev;

        pushToUndoStack(prev);
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          ...updates,
          updatedAt: new Date().toISOString(),
        } as Annotation;
        return updated;
      });
    },
    [pushToUndoStack]
  );

  // Delete an annotation
  const deleteAnnotation = useCallback(
    (id: string) => {
      setAnnotations((prev) => {
        pushToUndoStack(prev);
        return prev.filter((a) => a.id !== id);
      });

      if (selectedAnnotationId === id) {
        setSelectedAnnotationId(null);
      }
    },
    [pushToUndoStack, selectedAnnotationId]
  );

  // Clear all annotations
  const clearAnnotations = useCallback(() => {
    setAnnotations((prev) => {
      if (prev.length > 0) {
        pushToUndoStack(prev);
      }
      return [];
    });
    setSelectedAnnotationId(null);
  }, [pushToUndoStack]);

  // Undo last action
  const undo = useCallback(() => {
    if (undoStack.length === 0) return;

    const previousState = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, annotations]);
    setAnnotations(previousState);
    setSelectedAnnotationId(null);
  }, [undoStack, annotations]);

  // Redo last undone action
  const redo = useCallback(() => {
    if (redoStack.length === 0) return;

    const nextState = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, annotations]);
    setAnnotations(nextState);
    setSelectedAnnotationId(null);
  }, [redoStack, annotations]);

  // Load annotations from external source
  const loadAnnotations = useCallback((newAnnotations: Annotation[]) => {
    setAnnotations(newAnnotations);
    setUndoStack([]);
    setRedoStack([]);
    setIsModified(false);
    setSelectedAnnotationId(null);
  }, []);

  // Export annotations for saving
  const exportAnnotations = useCallback(() => {
    return [...annotations];
  }, [annotations]);

  // Reset modified flag after save
  const resetModified = useCallback(() => {
    setIsModified(false);
  }, []);

  return {
    annotations,
    activeTool,
    activeColor,
    strokeWidth,
    fontSize,
    opacity,
    selectedAnnotationId,
    isModified,
    canUndo,
    canRedo,

    setActiveTool,
    setActiveColor,
    setStrokeWidth,
    setFontSize,
    setOpacity,
    setSelectedAnnotationId,

    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    clearAnnotations,

    undo,
    redo,

    loadAnnotations,
    exportAnnotations,
    resetModified,
  };
};

export default useAnnotations;
