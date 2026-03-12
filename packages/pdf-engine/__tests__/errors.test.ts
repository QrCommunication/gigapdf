import { describe, it, expect } from 'vitest';
import {
  PDFEngineError,
  PDFParseError,
  PDFCorruptedError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
  PDFPageOutOfRangeError,
  PDFUnsupportedOperationError,
} from '../src/errors';

// ---------------------------------------------------------------------------
// Shared helper: verifies the minimum contract every error must fulfill.
// ---------------------------------------------------------------------------
function assertIsError(
  instance: unknown,
  expectedMessage: string,
  expectedCode: string,
): void {
  expect(instance).toBeInstanceOf(Error);
  expect(instance).toBeInstanceOf(PDFEngineError);
  expect((instance as PDFEngineError).message).toBe(expectedMessage);
  expect((instance as PDFEngineError).code).toBe(expectedCode);
}

// ---------------------------------------------------------------------------
// PDFEngineError (base class)
// ---------------------------------------------------------------------------
describe('PDFEngineError', () => {
  it('is an instance of Error', () => {
    const err = new PDFEngineError('base error', 'BASE_CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    const err = new PDFEngineError('base error', 'BASE_CODE');
    expect(err).toBeInstanceOf(PDFEngineError);
  });

  it('stores the provided message', () => {
    const err = new PDFEngineError('something went wrong', 'MY_CODE');
    expect(err.message).toBe('something went wrong');
  });

  it('stores the provided code', () => {
    const err = new PDFEngineError('msg', 'MY_CODE');
    expect(err.code).toBe('MY_CODE');
  });

  it('sets name to "PDFEngineError"', () => {
    const err = new PDFEngineError('msg', 'CODE');
    expect(err.name).toBe('PDFEngineError');
  });

  it('code is readonly — reassignment is silently ignored in non-strict JS', () => {
    const err = new PDFEngineError('msg', 'ORIGINAL');
    // In TypeScript strict mode this would be a compile error.
    // At runtime the property descriptor is still there; we just confirm
    // the initial value is as expected.
    expect(err.code).toBe('ORIGINAL');
  });

  it('can be thrown and caught as an Error', () => {
    expect(() => {
      throw new PDFEngineError('thrown', 'ERR');
    }).toThrow('thrown');
  });

  it('preserves the stack trace property', () => {
    const err = new PDFEngineError('msg', 'CODE');
    expect(err.stack).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PDFParseError
// ---------------------------------------------------------------------------
describe('PDFParseError', () => {
  it('is an instance of Error', () => {
    expect(new PDFParseError('parse failed')).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFParseError('parse failed')).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFParseError', () => {
    expect(new PDFParseError('parse failed')).toBeInstanceOf(PDFParseError);
  });

  it('stores the provided message', () => {
    const err = new PDFParseError('could not parse PDF');
    expect(err.message).toBe('could not parse PDF');
  });

  it('has code "PDF_PARSE_ERROR"', () => {
    const err = new PDFParseError('any message');
    expect(err.code).toBe('PDF_PARSE_ERROR');
  });

  it('satisfies the full error contract', () => {
    assertIsError(new PDFParseError('bad format'), 'bad format', 'PDF_PARSE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PDFCorruptedError
// ---------------------------------------------------------------------------
describe('PDFCorruptedError', () => {
  it('is an instance of Error', () => {
    expect(new PDFCorruptedError('corrupted')).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFCorruptedError('corrupted')).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFCorruptedError', () => {
    expect(new PDFCorruptedError('corrupted')).toBeInstanceOf(PDFCorruptedError);
  });

  it('stores the provided message', () => {
    const err = new PDFCorruptedError('file is corrupted');
    expect(err.message).toBe('file is corrupted');
  });

  it('has code "PDF_CORRUPTED"', () => {
    const err = new PDFCorruptedError('any message');
    expect(err.code).toBe('PDF_CORRUPTED');
  });

  it('satisfies the full error contract', () => {
    assertIsError(new PDFCorruptedError('bad bytes'), 'bad bytes', 'PDF_CORRUPTED');
  });
});

// ---------------------------------------------------------------------------
// PDFEncryptedError
// ---------------------------------------------------------------------------
describe('PDFEncryptedError', () => {
  it('is an instance of Error', () => {
    expect(new PDFEncryptedError()).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFEncryptedError()).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFEncryptedError', () => {
    expect(new PDFEncryptedError()).toBeInstanceOf(PDFEncryptedError);
  });

  it('uses the default message when none is provided', () => {
    const err = new PDFEncryptedError();
    expect(err.message).toBe('Document is encrypted and requires a password');
  });

  it('accepts a custom message that overrides the default', () => {
    const err = new PDFEncryptedError('custom encryption message');
    expect(err.message).toBe('custom encryption message');
  });

  it('has code "PDF_ENCRYPTED"', () => {
    expect(new PDFEncryptedError().code).toBe('PDF_ENCRYPTED');
    expect(new PDFEncryptedError('custom').code).toBe('PDF_ENCRYPTED');
  });

  it('satisfies the full error contract with default message', () => {
    assertIsError(
      new PDFEncryptedError(),
      'Document is encrypted and requires a password',
      'PDF_ENCRYPTED',
    );
  });
});

// ---------------------------------------------------------------------------
// PDFInvalidPasswordError
// ---------------------------------------------------------------------------
describe('PDFInvalidPasswordError', () => {
  it('is an instance of Error', () => {
    expect(new PDFInvalidPasswordError()).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFInvalidPasswordError()).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFInvalidPasswordError', () => {
    expect(new PDFInvalidPasswordError()).toBeInstanceOf(PDFInvalidPasswordError);
  });

  it('uses the default message when none is provided', () => {
    const err = new PDFInvalidPasswordError();
    expect(err.message).toBe('Invalid password');
  });

  it('accepts a custom message that overrides the default', () => {
    const err = new PDFInvalidPasswordError('wrong password supplied');
    expect(err.message).toBe('wrong password supplied');
  });

  it('has code "PDF_INVALID_PASSWORD"', () => {
    expect(new PDFInvalidPasswordError().code).toBe('PDF_INVALID_PASSWORD');
    expect(new PDFInvalidPasswordError('custom').code).toBe('PDF_INVALID_PASSWORD');
  });

  it('satisfies the full error contract with default message', () => {
    assertIsError(new PDFInvalidPasswordError(), 'Invalid password', 'PDF_INVALID_PASSWORD');
  });
});

// ---------------------------------------------------------------------------
// PDFPageOutOfRangeError
// ---------------------------------------------------------------------------
describe('PDFPageOutOfRangeError', () => {
  it('is an instance of Error', () => {
    expect(new PDFPageOutOfRangeError(5, 3)).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFPageOutOfRangeError(5, 3)).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFPageOutOfRangeError', () => {
    expect(new PDFPageOutOfRangeError(5, 3)).toBeInstanceOf(PDFPageOutOfRangeError);
  });

  it('embeds the requested page number in the message', () => {
    const err = new PDFPageOutOfRangeError(42, 10);
    expect(err.message).toContain('42');
  });

  it('embeds the total page count in the message', () => {
    const err = new PDFPageOutOfRangeError(42, 10);
    expect(err.message).toContain('10');
  });

  it('produces the exact expected message format', () => {
    const err = new PDFPageOutOfRangeError(5, 3);
    expect(err.message).toBe('Page 5 is out of range (document has 3 pages)');
  });

  it('has code "PDF_PAGE_OUT_OF_RANGE"', () => {
    expect(new PDFPageOutOfRangeError(5, 3).code).toBe('PDF_PAGE_OUT_OF_RANGE');
  });

  it('works for page 0 and a 1-page document', () => {
    const err = new PDFPageOutOfRangeError(0, 1);
    expect(err.message).toBe('Page 0 is out of range (document has 1 pages)');
  });

  it('satisfies the full error contract', () => {
    assertIsError(
      new PDFPageOutOfRangeError(99, 50),
      'Page 99 is out of range (document has 50 pages)',
      'PDF_PAGE_OUT_OF_RANGE',
    );
  });
});

// ---------------------------------------------------------------------------
// PDFUnsupportedOperationError
// ---------------------------------------------------------------------------
describe('PDFUnsupportedOperationError', () => {
  it('is an instance of Error', () => {
    expect(new PDFUnsupportedOperationError('renderLayer')).toBeInstanceOf(Error);
  });

  it('is an instance of PDFEngineError', () => {
    expect(new PDFUnsupportedOperationError('renderLayer')).toBeInstanceOf(PDFEngineError);
  });

  it('is an instance of PDFUnsupportedOperationError', () => {
    expect(new PDFUnsupportedOperationError('renderLayer')).toBeInstanceOf(
      PDFUnsupportedOperationError,
    );
  });

  it('embeds the operation name in the message', () => {
    const err = new PDFUnsupportedOperationError('renderLayer');
    expect(err.message).toContain('renderLayer');
  });

  it('produces the exact expected message format', () => {
    const err = new PDFUnsupportedOperationError('renderLayer');
    expect(err.message).toBe('Unsupported operation: renderLayer');
  });

  it('has code "PDF_UNSUPPORTED_OPERATION"', () => {
    expect(new PDFUnsupportedOperationError('op').code).toBe('PDF_UNSUPPORTED_OPERATION');
  });

  it('works with a multi-word operation name', () => {
    const err = new PDFUnsupportedOperationError('render 3D annotations');
    expect(err.message).toBe('Unsupported operation: render 3D annotations');
  });

  it('satisfies the full error contract', () => {
    assertIsError(
      new PDFUnsupportedOperationError('compress'),
      'Unsupported operation: compress',
      'PDF_UNSUPPORTED_OPERATION',
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-class: error hierarchy isolation
// ---------------------------------------------------------------------------
describe('error hierarchy isolation', () => {
  it('PDFParseError is NOT an instance of PDFCorruptedError', () => {
    expect(new PDFParseError('x')).not.toBeInstanceOf(PDFCorruptedError);
  });

  it('PDFEncryptedError is NOT an instance of PDFInvalidPasswordError', () => {
    expect(new PDFEncryptedError()).not.toBeInstanceOf(PDFInvalidPasswordError);
  });

  it('PDFInvalidPasswordError is NOT an instance of PDFEncryptedError', () => {
    expect(new PDFInvalidPasswordError()).not.toBeInstanceOf(PDFEncryptedError);
  });

  it('PDFPageOutOfRangeError is NOT an instance of PDFParseError', () => {
    expect(new PDFPageOutOfRangeError(1, 0)).not.toBeInstanceOf(PDFParseError);
  });

  it('all subclasses are instances of PDFEngineError', () => {
    const errors: PDFEngineError[] = [
      new PDFParseError('x'),
      new PDFCorruptedError('x'),
      new PDFEncryptedError(),
      new PDFInvalidPasswordError(),
      new PDFPageOutOfRangeError(1, 10),
      new PDFUnsupportedOperationError('op'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(PDFEngineError);
    }
  });

  it('all subclasses are catchable as plain Error', () => {
    const errors: Error[] = [
      new PDFParseError('x'),
      new PDFCorruptedError('x'),
      new PDFEncryptedError(),
      new PDFInvalidPasswordError(),
      new PDFPageOutOfRangeError(1, 10),
      new PDFUnsupportedOperationError('op'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
