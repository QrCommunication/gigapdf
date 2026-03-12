import { describe, it, expect } from 'vitest';
import { parsePageRange, type PageRange } from '../../src/utils/page-range';

describe('parsePageRange', () => {
  describe('valid continuous ranges ("start-end")', () => {
    it('parses "1-5" with 10 pages into a single range [{start:1, end:5}]', () => {
      const result = parsePageRange('1-5', 10);
      expect(result).toEqual<PageRange[]>([{ start: 1, end: 5 }]);
    });

    it('parses "1-10" covering the entire document', () => {
      const result = parsePageRange('1-10', 10);
      expect(result).toEqual<PageRange[]>([{ start: 1, end: 10 }]);
    });

    it('parses "2-4" into [{start:2, end:4}]', () => {
      const result = parsePageRange('2-4', 10);
      expect(result).toEqual<PageRange[]>([{ start: 2, end: 4 }]);
    });

    it('parses a range ending exactly at pageCount', () => {
      const result = parsePageRange('5-10', 10);
      expect(result).toEqual<PageRange[]>([{ start: 5, end: 10 }]);
    });

    it('parses a single-page range expressed as "n-n"', () => {
      const result = parsePageRange('3-3', 10);
      expect(result).toEqual<PageRange[]>([{ start: 3, end: 3 }]);
    });
  });

  describe('valid comma-separated single pages ("n,m,...")', () => {
    it('parses "1,3,5" into three single-page ranges', () => {
      const result = parsePageRange('1,3,5', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 1, end: 1 },
        { start: 3, end: 3 },
        { start: 5, end: 5 },
      ]);
    });

    it('parses a single page number "3" into [{start:3, end:3}]', () => {
      const result = parsePageRange('3', 10);
      expect(result).toEqual<PageRange[]>([{ start: 3, end: 3 }]);
    });

    it('parses page "1" correctly', () => {
      const result = parsePageRange('1', 10);
      expect(result).toEqual<PageRange[]>([{ start: 1, end: 1 }]);
    });

    it('parses page equal to pageCount correctly', () => {
      const result = parsePageRange('10', 10);
      expect(result).toEqual<PageRange[]>([{ start: 10, end: 10 }]);
    });

    it('handles extra whitespace around commas', () => {
      const result = parsePageRange('1 , 3 , 5', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 1, end: 1 },
        { start: 3, end: 3 },
        { start: 5, end: 5 },
      ]);
    });
  });

  describe('valid mixed ranges ("start-end,n,start-end")', () => {
    it('parses "1-3,7-9" into two ranges', () => {
      const result = parsePageRange('1-3,7-9', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 1, end: 3 },
        { start: 7, end: 9 },
      ]);
    });

    it('parses "1-3,5,7-9" into two ranges and one single page', () => {
      const result = parsePageRange('1-3,5,7-9', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 1, end: 3 },
        { start: 5, end: 5 },
        { start: 7, end: 9 },
      ]);
    });

    it('parses "2,4-6,8" into single + range + single', () => {
      const result = parsePageRange('2,4-6,8', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 2, end: 2 },
        { start: 4, end: 6 },
        { start: 8, end: 8 },
      ]);
    });

    it('parses "1-3,5,7-9,10" mixing all patterns', () => {
      const result = parsePageRange('1-3,5,7-9,10', 10);
      expect(result).toEqual<PageRange[]>([
        { start: 1, end: 3 },
        { start: 5, end: 5 },
        { start: 7, end: 9 },
        { start: 10, end: 10 },
      ]);
    });
  });

  describe('edge cases — valid inputs at boundaries', () => {
    it('parses the full range "1-10" on a 10-page document', () => {
      const result = parsePageRange('1-10', 10);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ start: 1, end: 10 });
    });

    it('parses a 1-page document with "1"', () => {
      const result = parsePageRange('1', 1);
      expect(result).toEqual<PageRange[]>([{ start: 1, end: 1 }]);
    });

    it('parses a 1-page document with "1-1"', () => {
      const result = parsePageRange('1-1', 1);
      expect(result).toEqual<PageRange[]>([{ start: 1, end: 1 }]);
    });
  });

  describe('invalid ranges — should throw', () => {
    describe('page number below 1 (zero or negative)', () => {
      it('throws for range "0-5" (start below 1)', () => {
        expect(() => parsePageRange('0-5', 10)).toThrow();
      });

      it('throws for page number "0"', () => {
        expect(() => parsePageRange('0', 10)).toThrow();
      });

      it('includes the invalid part in the error message for range "0-5"', () => {
        expect(() => parsePageRange('0-5', 10)).toThrowError('0-5');
      });
    });

    describe('page number exceeding pageCount', () => {
      it('throws for range "1-15" when document has 10 pages', () => {
        expect(() => parsePageRange('1-15', 10)).toThrow();
      });

      it('throws for single page "11" when document has 10 pages', () => {
        expect(() => parsePageRange('11', 10)).toThrow();
      });

      it('includes pageCount in the error message', () => {
        expect(() => parsePageRange('1-15', 10)).toThrowError('10');
      });
    });

    describe('reversed range (start > end)', () => {
      it('throws for "5-3" (start greater than end)', () => {
        expect(() => parsePageRange('5-3', 10)).toThrow();
      });

      it('throws for "10-1" (reversed full range)', () => {
        expect(() => parsePageRange('10-1', 10)).toThrow();
      });

      it('includes the invalid part in the error message for "5-3"', () => {
        expect(() => parsePageRange('5-3', 10)).toThrowError('5-3');
      });
    });

    describe('non-numeric input', () => {
      it('throws for "abc"', () => {
        expect(() => parsePageRange('abc', 10)).toThrow();
      });

      it('throws for "a-b"', () => {
        expect(() => parsePageRange('a-b', 10)).toThrow();
      });

      it('throws for "1-z"', () => {
        expect(() => parsePageRange('1-z', 10)).toThrow();
      });

      it('throws for "z-5"', () => {
        expect(() => parsePageRange('z-5', 10)).toThrow();
      });
    });

    describe('mixed valid and invalid parts', () => {
      it('throws when at least one part is invalid even if others are valid', () => {
        // "1-3" is valid, "20" is invalid for a 10-page document
        expect(() => parsePageRange('1-3,20', 10)).toThrow();
      });

      it('throws when a later range segment is reversed', () => {
        expect(() => parsePageRange('1-3,9-7', 10)).toThrow();
      });
    });
  });

  describe('return value structure', () => {
    it('always returns an array', () => {
      const result = parsePageRange('1-5', 10);
      expect(Array.isArray(result)).toBe(true);
    });

    it('each item has integer start and end properties', () => {
      const result = parsePageRange('2-4', 10);
      expect(Number.isInteger(result[0]!.start)).toBe(true);
      expect(Number.isInteger(result[0]!.end)).toBe(true);
    });

    it('start is always <= end in every returned range', () => {
      const result = parsePageRange('1-3,5,7-9', 10);
      for (const range of result) {
        expect(range.start).toBeLessThanOrEqual(range.end);
      }
    });
  });
});
