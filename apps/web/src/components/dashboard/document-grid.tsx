"use client";

import { DocumentCard } from "./document-card";
import { DragItem } from "./document-explorer";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentGridProps {
  documents: Document[];
  onDelete?: () => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  draggedItem?: DragItem | null;
}

export function DocumentGrid({
  documents,
  onDelete,
  onDragStart,
  onDragEnd,
  draggedItem,
}: DocumentGridProps) {
  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          id={doc.id}
          name={doc.name}
          size={doc.size}
          createdAt={doc.createdAt}
          updatedAt={doc.updatedAt}
          onDelete={onDelete}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          isDragging={draggedItem?.type === "document" && draggedItem?.id === doc.id}
        />
      ))}
    </div>
  );
}
