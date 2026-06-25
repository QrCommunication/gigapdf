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

/**
 * Raised for public-key (certificate) encryption failures: an unparseable
 * recipient X.509 certificate (encrypt) or a certificate/private-key pair that
 * is not a recipient of the document (decrypt). Deliberately generic — callers
 * must NOT reveal which half of the credential was at fault.
 */
export class PDFInvalidCertificateError extends PDFEngineError {
  constructor(message = 'Invalid certificate or private key') {
    super(message, 'PDF_INVALID_CERTIFICATE');
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
