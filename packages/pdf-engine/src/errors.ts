export class PDFEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PDFEngineError';
  }
}

export class PDFParseError extends PDFEngineError {
  constructor(message: string) {
    super(message, 'PDF_PARSE_ERROR');
  }
}

export class PDFCorruptedError extends PDFEngineError {
  constructor(message: string) {
    super(message, 'PDF_CORRUPTED');
  }
}

export class PDFEncryptedError extends PDFEngineError {
  constructor(message = 'Document is encrypted and requires a password') {
    super(message, 'PDF_ENCRYPTED');
  }
}

export class PDFInvalidPasswordError extends PDFEngineError {
  constructor(message = 'Invalid password') {
    super(message, 'PDF_INVALID_PASSWORD');
  }
}

export class PDFPageOutOfRangeError extends PDFEngineError {
  constructor(pageNumber: number, pageCount: number) {
    super(
      `Page ${pageNumber} is out of range (document has ${pageCount} pages)`,
      'PDF_PAGE_OUT_OF_RANGE',
    );
  }
}

export class PDFUnsupportedOperationError extends PDFEngineError {
  constructor(operation: string) {
    super(`Unsupported operation: ${operation}`, 'PDF_UNSUPPORTED_OPERATION');
  }
}
