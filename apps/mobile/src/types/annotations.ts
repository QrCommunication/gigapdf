/**
 * Types for PDF annotations
 */

export type AnnotationType =
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'drawing'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'signature'
  | 'stamp'
  | 'note';

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  type: AnnotationType;
  page: number;
  createdAt: string;
  updatedAt: string;
  color: string;
  opacity: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  position: Point;
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'highlight' | 'underline' | 'strikethrough';
  startPoint: Point;
  endPoint: Point;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface DrawingAnnotation extends AnnotationBase {
  type: 'drawing';
  points: Point[];
  strokeWidth: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'arrow' | 'rectangle' | 'circle';
  startPoint: Point;
  endPoint: Point;
  strokeWidth: number;
  filled: boolean;
  fillColor?: string;
}

export interface SignatureAnnotation extends AnnotationBase {
  type: 'signature';
  position: Point;
  width: number;
  height: number;
  imageData: string; // Base64 encoded image
}

export interface NoteAnnotation extends AnnotationBase {
  type: 'note';
  position: Point;
  content: string;
  isOpen: boolean;
}

export interface StampAnnotation extends AnnotationBase {
  type: 'stamp';
  position: Point;
  width: number;
  height: number;
  stampType: 'approved' | 'rejected' | 'draft' | 'confidential' | 'final' | 'custom';
  customText?: string;
}

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | DrawingAnnotation
  | ShapeAnnotation
  | SignatureAnnotation
  | NoteAnnotation
  | StampAnnotation;

export type EditorTool =
  | 'select'
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'drawing'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'signature'
  | 'stamp'
  | 'note'
  | 'eraser';

export interface EditorState {
  activeTool: EditorTool;
  activeColor: string;
  strokeWidth: number;
  fontSize: number;
  opacity: number;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  undoStack: Annotation[][];
  redoStack: Annotation[][];
  isModified: boolean;
}

export const defaultEditorState: Omit<EditorState, 'annotations'> = {
  activeTool: 'select',
  activeColor: '#FF0000',
  strokeWidth: 2,
  fontSize: 14,
  opacity: 1,
  selectedAnnotationId: null,
  undoStack: [],
  redoStack: [],
  isModified: false,
};

export const toolColors = [
  '#FF0000', // Red
  '#FF6B00', // Orange
  '#FFCC00', // Yellow
  '#00CC00', // Green
  '#0066FF', // Blue
  '#9900FF', // Purple
  '#FF0099', // Pink
  '#000000', // Black
  '#666666', // Gray
  '#FFFFFF', // White
];

export const strokeWidths = [1, 2, 3, 5, 8, 12];
export const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
