export interface PageRange {
  start: number; // 1-indexed
  end: number;   // 1-indexed, inclusive
}

/**
 * Parse a page range string into an array of PageRange objects.
 *
 * Supports formats:
 * - "1-5" → [{start: 1, end: 5}]
 * - "1,3,5" → [{start: 1, end: 1}, {start: 3, end: 3}, {start: 5, end: 5}]
 * - "1-3,7-9" → [{start: 1, end: 3}, {start: 7, end: 9}]
 * - "1-3,5,7-9" → [{start: 1, end: 3}, {start: 5, end: 5}, {start: 7, end: 9}]
 *
 * @param rangeStr - Page range string
 * @param pageCount - Total number of pages (for validation)
 * @returns Array of PageRange objects
 */
export function parsePageRange(rangeStr: string, pageCount: number): PageRange[] {
  const ranges: PageRange[] = [];
  const parts = rangeStr.split(',').map((s) => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);

      if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > pageCount) {
        throw new Error(`Invalid page range: "${part}" (document has ${pageCount} pages)`);
      }

      ranges.push({ start, end });
    } else {
      const page = parseInt(part, 10);

      if (isNaN(page) || page < 1 || page > pageCount) {
        throw new Error(`Invalid page number: "${part}" (document has ${pageCount} pages)`);
      }

      ranges.push({ start: page, end: page });
    }
  }

  return ranges;
}
