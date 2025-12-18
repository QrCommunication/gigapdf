"use client";

import { DocumentCard } from "./document-card";

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
}

export function DocumentGrid({ documents, onDelete }: DocumentGridProps) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <h3 className="text-lg font-semibold">No documents yet</h3>
        <p className="text-muted-foreground">
          Create your first PDF document to get started
        </p>
      </div>
    );
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
        />
      ))}
    </div>
  );
}
