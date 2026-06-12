/**
 * Tests smoke pour la conversion Office <-> PDF via LibreOffice headless.
 *
 * Les tests de conversion sont conditionnes a la presence de `soffice` dans
 * le PATH via `it.runIf(sofficAvailable)`. Sur un CI sans LibreOffice
 * installe les tests sont skippes proprement sans erreur. Les tests de la
 * table des formats (fonctions pures) tournent partout.
 *
 * Test 1 : DOCX minimal cree en memoire → PDF → validation magic %PDF-
 * Test 2 : PDF de debug existant (/tmp/gigapdf-debug/v1.pdf) → DOCX → ZIP PK
 * Test 3 : PDF → XLSX rejette (non supporte par LibreOffice)
 * Test 4 : meme PDF → PPTX → ZIP PK
 * Test 5 : test-free.pdf → ODT → ZIP PK + mimetype opendocument.text
 * Test 6 : test-free.pdf → ODP → ZIP PK + mimetype opendocument.presentation
 * Test 7 : roundtrip ODT → PDF (chemin d'import OpenDocument)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  convertOfficeToPdf,
  convertPdfToOffice,
  isOfficeImportFormat,
  isPdfExportFormat,
  LibreOfficeUnavailableError,
  OFFICE_IMPORT_FORMATS,
  PDF_EXPORT_FORMATS,
} from '../../src/convert/office-headless';

// ── Pre-condition globale ────────────────────────────────────────────────────
// it.runIf() evalue la condition au moment de la declaration — AVANT beforeAll.
// On doit donc resoudre synchronement au niveau du module.

function checkSoffice(): boolean {
  try {
    execSync('which soffice', { stdio: 'ignore' });
    return true;
  } catch {
    process.stderr.write(
      '\n[office-headless] soffice not found in PATH — conversion tests skipped.\n' +
        '  Install: sudo apt-get install -y libreoffice-core libreoffice-writer ' +
        'libreoffice-calc libreoffice-impress\n\n',
    );
    return false;
  }
}

const sofficAvailable = checkSoffice();

/**
 * PDF d'exemple a la racine du repo, utilise pour les conversions ODT/ODP
 * reelles. Resolu depuis le cwd du package OU depuis la racine du monorepo
 * selon l'endroit d'ou vitest est lance.
 */
function findSamplePdf(): string | null {
  const candidates = [
    join(process.cwd(), 'test-free.pdf'),
    join(process.cwd(), '..', '..', 'test-free.pdf'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const samplePdfPath = findSamplePdf();

/** Verifie ZIP magic PK\x03\x04 en tete de buffer. */
function expectZipMagic(result: Uint8Array): void {
  expect(result[0]).toBe(0x50); // P
  expect(result[1]).toBe(0x4b); // K
  expect(result[2]).toBe(0x03);
  expect(result[3]).toBe(0x04);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Construit un DOCX valide (ZIP PK) en memoire pur Node.js, sans dependance.
 * Produit un ZIP non-compresse avec les 3 fichiers minimaux qu'attend LibreOffice.
 */
function buildZipBasedDocx(): Buffer {
  const contentTypes = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    'utf8',
  );

  const rels = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'utf8',
  );

  const document = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      '<w:p><w:r><w:t>Hello GigaPDF</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>' +
      '</w:body>' +
      '</w:document>',
    'utf8',
  );

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
  ]);
}

/** Construit un fichier ZIP STORE (non-compresse) compatible avec le format OOXML. */
function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // STORE (no compression)
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    parts.push(local, entry.data);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(entry.data.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);
    centralDir.push(cd);

    offset += local.length + entry.data.length;
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocdr = Buffer.alloc(22);
  eocdr.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocdr.writeUInt16LE(0, 4);
  eocdr.writeUInt16LE(0, 6);
  eocdr.writeUInt16LE(entries.length, 8);
  eocdr.writeUInt16LE(entries.length, 10);
  eocdr.writeUInt32LE(cdBuf.length, 12);
  eocdr.writeUInt32LE(offset, 16);
  eocdr.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocdr]);
}

/** CRC-32 (polynome ZIP 0xEDB88320). */
function crc32(buf: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (table[(crc ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function makeCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[i] = c;
  }
  return _crcTable;
}

// ── Suite de tests ────────────────────────────────────────────────────────────

describe('convertOfficeToPdf', () => {
  it.runIf(sofficAvailable)(
    'Test 1 — convertit un DOCX minimal en PDF (magic %PDF-)',
    async () => {
      const docxBytes = buildZipBasedDocx();

      // Verifier que le DOCX genere est un ZIP valide
      expect(docxBytes[0]).toBe(0x50); // P
      expect(docxBytes[1]).toBe(0x4b); // K
      expect(docxBytes[2]).toBe(0x03);
      expect(docxBytes[3]).toBe(0x04);

      const start = Date.now();
      const result = await convertOfficeToPdf(new Uint8Array(docxBytes), 'docx');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] docx→pdf: ${elapsed}ms\n`);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(100);

      // Magic bytes %PDF-
      const head = Buffer.from(result.subarray(0, 5));
      expect(head.toString('ascii')).toBe('%PDF-');
    },
    45_000,
  );
});

describe('convertPdfToOffice', () => {
  const debugPdf = '/tmp/gigapdf-debug/v1.pdf';
  const pdfAvailable = existsSync(debugPdf);

  it.runIf(sofficAvailable && pdfAvailable)(
    'Test 2 — convertit v1.pdf en DOCX (magic ZIP PK)',
    async () => {
      const pdfBytes = new Uint8Array(readFileSync(debugPdf));

      const start = Date.now();
      const result = await convertPdfToOffice(pdfBytes, 'docx');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] pdf→docx: ${elapsed}ms\n`);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(100);

      // Magic bytes ZIP PK\x03\x04
      expect(result[0]).toBe(0x50); // P
      expect(result[1]).toBe(0x4b); // K
      expect(result[2]).toBe(0x03);
      expect(result[3]).toBe(0x04);
    },
    45_000,
  );

  it(
    'Test 3 — PDF vers XLSX rejette avec LibreOfficeConversionError (non supporte)',
    async () => {
      // LibreOffice ne peut pas convertir un PDF en tableur — la fonction doit
      // rejeter immediatement avec une erreur explicite, sans spawner soffice.
      const fakePdfBytes = new Uint8Array(Buffer.from('%PDF-1.4 minimal'));
      await expect(convertPdfToOffice(fakePdfBytes, 'xlsx')).rejects.toThrow(
        'PDF → XLSX is not supported by LibreOffice headless',
      );
    },
  );

  it.runIf(sofficAvailable && pdfAvailable)(
    'Test 4 — convertit v1.pdf en PPTX (magic ZIP PK)',
    async () => {
      const pdfBytes = new Uint8Array(readFileSync(debugPdf));

      const start = Date.now();
      const result = await convertPdfToOffice(pdfBytes, 'pptx');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] pdf→pptx: ${elapsed}ms\n`);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(100);

      expect(result[0]).toBe(0x50); // P
      expect(result[1]).toBe(0x4b); // K
      expect(result[2]).toBe(0x03);
      expect(result[3]).toBe(0x04);
    },
    45_000,
  );
});

describe('convertPdfToOffice — OpenDocument targets (odt/odp)', () => {
  const pdfAvailable = samplePdfPath !== null;

  it.runIf(sofficAvailable && pdfAvailable)(
    'Test 5 — convertit test-free.pdf en ODT (ZIP PK + mimetype opendocument.text)',
    async () => {
      const pdfBytes = new Uint8Array(readFileSync(samplePdfPath as string));

      const start = Date.now();
      const result = await convertPdfToOffice(pdfBytes, 'odt');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] pdf→odt: ${elapsed}ms\n`);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(100);
      expectZipMagic(result);

      // Conformement a la spec ODF, la premiere entree du ZIP est `mimetype`,
      // stockee NON compressee — la chaine est donc presente en clair.
      const ascii = Buffer.from(result).toString('latin1');
      expect(ascii).toContain('application/vnd.oasis.opendocument.text');
    },
    45_000,
  );

  it.runIf(sofficAvailable && pdfAvailable)(
    'Test 6 — convertit test-free.pdf en ODP (ZIP PK + mimetype opendocument.presentation)',
    async () => {
      const pdfBytes = new Uint8Array(readFileSync(samplePdfPath as string));

      const start = Date.now();
      const result = await convertPdfToOffice(pdfBytes, 'odp');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] pdf→odp: ${elapsed}ms\n`);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(100);
      expectZipMagic(result);

      const ascii = Buffer.from(result).toString('latin1');
      expect(ascii).toContain('application/vnd.oasis.opendocument.presentation');
    },
    45_000,
  );

  it.runIf(sofficAvailable && pdfAvailable)(
    'Test 7 — roundtrip : ODT produit reimporte en PDF (chemin import OpenDocument)',
    async () => {
      const pdfBytes = new Uint8Array(readFileSync(samplePdfPath as string));
      const odtBytes = await convertPdfToOffice(pdfBytes, 'odt');

      const start = Date.now();
      const pdfAgain = await convertOfficeToPdf(odtBytes, 'odt');
      const elapsed = Date.now() - start;

      process.stdout.write(`\n  [timing] odt→pdf: ${elapsed}ms\n`);

      expect(pdfAgain).toBeInstanceOf(Uint8Array);
      expect(pdfAgain.length).toBeGreaterThan(100);
      expect(Buffer.from(pdfAgain.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
    },
    90_000,
  );
});

describe('Tables de formats (fonctions pures)', () => {
  it('OFFICE_IMPORT_FORMATS contient exactement les 9 formats supportes', () => {
    expect([...OFFICE_IMPORT_FORMATS].sort()).toEqual(
      ['doc', 'docx', 'odp', 'ods', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].sort(),
    );
  });

  it('isOfficeImportFormat accepte chaque format de la table', () => {
    for (const format of OFFICE_IMPORT_FORMATS) {
      expect(isOfficeImportFormat(format)).toBe(true);
    }
  });

  it('isOfficeImportFormat rejette les formats inconnus, vides ou en casse differente', () => {
    expect(isOfficeImportFormat('pdf')).toBe(false);
    expect(isOfficeImportFormat('rtf')).toBe(false);
    expect(isOfficeImportFormat('txt')).toBe(false);
    expect(isOfficeImportFormat('')).toBe(false);
    expect(isOfficeImportFormat('DOCX')).toBe(false); // normalisation = responsabilite caller
  });

  it('PDF_EXPORT_FORMATS contient docx, xlsx, pptx, odt et odp', () => {
    expect([...PDF_EXPORT_FORMATS].sort()).toEqual(
      ['docx', 'odp', 'odt', 'pptx', 'xlsx'].sort(),
    );
  });

  it('isPdfExportFormat accepte chaque format de la table et rejette le reste', () => {
    for (const format of PDF_EXPORT_FORMATS) {
      expect(isPdfExportFormat(format)).toBe(true);
    }
    expect(isPdfExportFormat('ods')).toBe(false); // export tableur = convertPdfToXlsx only
    expect(isPdfExportFormat('doc')).toBe(false); // pas d'export legacy 97-2003
    expect(isPdfExportFormat('')).toBe(false);
  });
});

describe('LibreOfficeUnavailableError', () => {
  it('has the correct name property and message', () => {
    const err = new LibreOfficeUnavailableError();
    expect(err.name).toBe('LibreOfficeUnavailableError');
    expect(err.message).toContain('soffice');
    expect(err).toBeInstanceOf(Error);
  });
});
