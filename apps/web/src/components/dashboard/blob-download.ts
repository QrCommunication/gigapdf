/**
 * Trigger a browser download for an in-memory Blob.
 *
 * Lives outside any React component on purpose: building and mutating the
 * temporary <a> element inside a component callback trips the
 * react-hooks/immutability lint (the compiler assumes render-scope values
 * are immutable). A plain module function is exempt and reusable by every
 * export flow (document card, table, trash...).
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
