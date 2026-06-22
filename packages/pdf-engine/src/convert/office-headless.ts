/**
 * Conversion Office ↔ PDF via le moteur WASM `@qrcommunication/gigapdf-lib`.
 *
 * La conversion est faite entièrement en WebAssembly (zéro-dépendance,
 * déterministe, sûr pour les appels parallèles) : plus aucun binaire système,
 * plus aucun répertoire temporaire, plus aucune dépendance tierce.
 *
 * Note historique : ce module remplaçait un ancien chemin LibreOffice headless
 * (`soffice`) ; ce binaire n'est plus requis ni utilisé.
 */

import { getEngine } from '../wasm';

// ── Tables de formats ─────────────────────────────────────────────────────────

/**
 * Formats bureautiques acceptés en entrée pour la conversion Office → PDF.
 * Le moteur les auto-détecte par magic bytes :
 *  - OOXML (ZIP)            : docx, xlsx, pptx
 *  - Office 97-2003 (OLE2)  : doc, xls, ppt
 *  - OpenDocument (ZIP)     : odt, ods, odp
 */
export const OFFICE_IMPORT_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'doc',
  'xls',
  'ppt',
  'odt',
  'ods',
  'odp',
] as const;

export type OfficeImportFormat = (typeof OFFICE_IMPORT_FORMATS)[number];

/** Garde de type pure : `value` est-il un format d'import Office supporté ? */
export function isOfficeImportFormat(value: string): value is OfficeImportFormat {
  return (OFFICE_IMPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * Formats cibles supportés par {@link convertPdfToOffice}.
 * `xlsx` figure dans la signature pour compat d'appel mais rejette toujours
 * (un PDF n'est pas un tableur) — utiliser `convertPdfToXlsx` à la place.
 */
export const PDF_EXPORT_FORMATS = ['docx', 'xlsx', 'pptx', 'odt', 'odp'] as const;

export type PdfExportFormat = (typeof PDF_EXPORT_FORMATS)[number];

/** Garde de type pure : `value` est-il un format d'export PDF → Office supporté ? */
export function isPdfExportFormat(value: string): value is PdfExportFormat {
  return (PDF_EXPORT_FORMATS as readonly string[]).includes(value);
}

// ── Erreur dédiée ──────────────────────────────────────────────────────────────

/** Levée quand la conversion Office ↔ PDF échoue (contenu illisible, format cible non supporté). */
export class OfficeConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeConversionError';
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Convertit un fichier Office en PDF via le moteur WASM. Le format source est
 * auto-détecté ; `sourceFormat` n'est gardé que pour les messages d'erreur et
 * la compatibilité de signature.
 *
 * @throws {OfficeConversionError} si le contenu est non reconnu ou vide
 */
export async function convertOfficeToPdf(
  buffer: Uint8Array,
  sourceFormat: OfficeImportFormat,
): Promise<Uint8Array> {
  const giga = await getEngine();
  const pdf = giga.officeToPdf(buffer);
  if (pdf.length === 0) {
    throw new OfficeConversionError(
      `could not convert ${sourceFormat} document to PDF (unrecognized or empty content)`,
    );
  }
  return pdf;
}

/**
 * Convertit un PDF en fichier Office éditable (vrais éléments : texte positionné,
 * images ré-embarquées — pas une image de page).
 *
 *  - `docx` → Word OOXML
 *  - `pptx` → PowerPoint OOXML
 *  - `odt`  → OpenDocument Text
 *  - `odp`  → OpenDocument Presentation
 *  - `xlsx` → rejeté (utiliser `convertPdfToXlsx`)
 *
 * @throws {OfficeConversionError} si le PDF est illisible ou le format cible
 *                                  n'est pas supporté
 */
export async function convertPdfToOffice(
  buffer: Uint8Array,
  targetFormat: PdfExportFormat,
): Promise<Uint8Array> {
  if (targetFormat === 'xlsx') {
    throw new OfficeConversionError(
      'PDF → XLSX is not supported here: a PDF is not a spreadsheet. ' +
        'Use convertPdfToXlsx (table reconstruction) instead.',
    );
  }
  const giga = await getEngine();
  let doc;
  try {
    doc = giga.open(buffer);
  } catch {
    throw new OfficeConversionError('could not parse the source PDF');
  }
  try {
    switch (targetFormat) {
      case 'docx':
        return doc.toDocx();
      case 'pptx':
        return doc.toPptx();
      case 'odt':
        return doc.toOdt();
      case 'odp':
        return doc.toOdp();
    }
  } finally {
    doc.close();
  }
}
