/**
 * Conversion Office ↔ PDF via LibreOffice headless.
 *
 * LibreOffice est la solution de référence pour la conversion fidèle
 * de fichiers DOCX/XLSX/PPTX en PDF et vice-versa. Le binaire `soffice`
 * est spawné en mode headless — aucun affichage graphique requis. Il est
 * disponible dans tous les repos Debian/Ubuntu (paquet `libreoffice-core`).
 *
 * Chaque appel crée un répertoire temporaire isolé, y dépose le fichier
 * source, invoque `soffice --convert-to`, lit le fichier produit, puis
 * nettoie systématiquement (bloc `finally`). Timeout fixé à 30 secondes.
 *
 * Note : LibreOffice ne supporte pas les conversions parallèles depuis le
 * même profil utilisateur. Un verrou n'est pas implémenté ici car le
 * tmpdir dédié (`--env UserInstallation=file://…`) garantit l'isolation.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

// ── Constantes ────────────────────────────────────────────────────────────────

const SOFFICE_TIMEOUT_MS = 30_000;

/** Magic bytes attendus pour un fichier PDF valide. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/** Magic bytes attendus pour un fichier Office moderne (ZIP PK). */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// ── Tables de formats ─────────────────────────────────────────────────────────

/**
 * Formats bureautiques acceptés en entrée pour la conversion Office → PDF.
 * LibreOffice les importe tous nativement (aucun `--infilter` requis) :
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
 * (LibreOffice ne sait pas transformer un PDF en tableur) — utiliser
 * `convertPdfToXlsx` (extraction pdfjs + exceljs) à la place.
 *
 * `odt` et `odp` ont été validés en réel (LibreOffice 26.2, 2026-06-12) :
 * sortie ZIP PK avec entrée `mimetype` opendocument correcte.
 */
export const PDF_EXPORT_FORMATS = ['docx', 'xlsx', 'pptx', 'odt', 'odp'] as const;

export type PdfExportFormat = (typeof PDF_EXPORT_FORMATS)[number];

/** Garde de type pure : `value` est-il un format d'export PDF → Office supporté ? */
export function isPdfExportFormat(value: string): value is PdfExportFormat {
  return (PDF_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Formats cibles réellement convertis par LibreOffice (xlsx exclu). */
type LibreOfficeExportFormat = Exclude<PdfExportFormat, 'xlsx'>;

// ── Erreurs dédiées ───────────────────────────────────────────────────────────

export class LibreOfficeUnavailableError extends Error {
  constructor() {
    super('soffice (LibreOffice) binary not found in PATH');
    this.name = 'LibreOfficeUnavailableError';
  }
}

export class LibreOfficeConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibreOfficeConversionError';
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Convertit un fichier Office en PDF.
 *
 * Formats acceptés ({@link OFFICE_IMPORT_FORMATS}) :
 *  - OOXML            : docx, xlsx, pptx
 *  - Office 97-2003   : doc, xls, ppt (conteneur OLE2)
 *  - OpenDocument     : odt, ods, odp
 *
 * LibreOffice auto-détecte tous ces formats à l'import — seul le format de
 * sortie (`pdf`) est spécifié, aucun filtre d'import n'est nécessaire.
 *
 * @param buffer       — contenu binaire du fichier source
 * @param sourceFormat — format du fichier source (détermine l'extension du
 *                       fichier temporaire, indice de détection pour soffice)
 * @returns            bytes du fichier PDF produit (commence par `%PDF-`)
 * @throws {LibreOfficeUnavailableError} si `soffice` est absent du PATH
 * @throws {LibreOfficeConversionError}  si la conversion échoue ou produit un
 *                                        fichier invalide
 */
export async function convertOfficeToPdf(
  buffer: Uint8Array,
  sourceFormat: OfficeImportFormat,
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'gigapdf-lo-'));
  const inPath = join(dir, `input.${sourceFormat}`);
  // LibreOffice écrit le résultat dans outdir avec le même nom de base
  const outPath = join(dir, 'input.pdf');

  try {
    await writeFile(inPath, buffer);

    await runSoffice([
      '--headless',
      '--norestore',
      '--nofirststartwizard',
      // Profil utilisateur isolé pour permettre les appels parallèles
      `-env:UserInstallation=file://${dir}/profile`,
      '--convert-to',
      'pdf',
      '--outdir',
      dir,
      inPath,
    ]);

    const out = await readOutputFile(dir, 'input.pdf', outPath);
    validateMagic(out, PDF_MAGIC, '%PDF-');
    return new Uint8Array(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Convertit un fichier PDF en fichier Office.
 *
 * La conversion PDF → Office est une opération avec perte (mise en page,
 * polices embarquées non-transférables). Elle est utile pour extraction de
 * contenu, pas pour reproduction pixel-perfect.
 *
 * Filtres d'import LibreOffice utilisés :
 *  - `docx` → `writer_pdf_import`   (LibreOffice Writer)
 *  - `odt`  → `writer_pdf_import`   (LibreOffice Writer)
 *  - `pptx` → `impress_pdf_import`  (LibreOffice Impress/Draw)
 *  - `odp`  → `impress_pdf_import`  (LibreOffice Impress/Draw)
 *  - `xlsx` → non supporté nativement depuis un PDF (LibreOffice ne peut pas
 *              transformer un document textuel/graphique en tableur de façon
 *              fiable). Lance `LibreOfficeConversionError`.
 *
 * @param buffer       — contenu binaire du fichier PDF source
 * @param targetFormat — format cible (docx, pptx, odt ou odp ; xlsx non supporté)
 * @returns            bytes du fichier Office produit (ZIP PK)
 * @throws {LibreOfficeUnavailableError} si `soffice` est absent du PATH
 * @throws {LibreOfficeConversionError}  si la conversion échoue, le format
 *                                        cible n'est pas supporté depuis PDF,
 *                                        ou le fichier produit est invalide
 */
export async function convertPdfToOffice(
  buffer: Uint8Array,
  targetFormat: PdfExportFormat,
): Promise<Uint8Array> {
  // LibreOffice headless ne peut pas convertir un PDF en XLSX — un PDF n'est
  // pas un tableur et aucun filtre d'import Calc n'accepte le format PDF.
  if (targetFormat === 'xlsx') {
    throw new LibreOfficeConversionError(
      'PDF → XLSX is not supported by LibreOffice headless: a PDF document ' +
        'cannot be structurally interpreted as a spreadsheet. ' +
        'Use docx, pptx, odt or odp as target format instead.',
    );
  }

  // Filtre d'import selon le type d'application LibreOffice cible
  const infilterMap: Record<LibreOfficeExportFormat, string> = {
    docx: 'writer_pdf_import',
    pptx: 'impress_pdf_import',
    odt: 'writer_pdf_import',
    odp: 'impress_pdf_import',
  };
  // Filtre d'export nommé pour la cible Office / OpenDocument
  const exportFilterMap: Record<LibreOfficeExportFormat, string> = {
    docx: 'MS Word 2007 XML',
    pptx: 'Impress MS PowerPoint 2007 XML',
    odt: 'writer8',
    odp: 'impress8',
  };

  const dir = await mkdtemp(join(tmpdir(), 'gigapdf-lo-'));
  const inPath = join(dir, 'input.pdf');
  const outPath = join(dir, `input.${targetFormat}`);

  try {
    await writeFile(inPath, buffer);

    await runSoffice([
      '--headless',
      '--norestore',
      '--nofirststartwizard',
      `-env:UserInstallation=file://${dir}/profile`,
      `--infilter=${infilterMap[targetFormat]}`,
      '--convert-to',
      `${targetFormat}:${exportFilterMap[targetFormat]}`,
      '--outdir',
      dir,
      inPath,
    ]);

    const out = await readOutputFile(dir, `input.${targetFormat}`, outPath);
    validateMagic(out, ZIP_MAGIC, 'PK\\x03\\x04');
    return new Uint8Array(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Lit le fichier de sortie produit par LibreOffice. Tente d'abord le chemin
 * exact attendu ; si absent, liste le répertoire pour trouver le premier
 * fichier avec l'extension correcte (LibreOffice peut suffixer le nom dans
 * certains cas).
 */
async function readOutputFile(
  dir: string,
  expectedName: string,
  expectedPath: string,
): Promise<Buffer> {
  try {
    return await readFile(expectedPath);
  } catch {
    // Fallback : chercher par extension dans le répertoire de sortie
    const ext = extname(expectedName);
    const entries = await readdir(dir);
    const match = entries.find(
      (e) => e !== 'input' + extname(e).slice(0, -ext.length) && e.endsWith(ext) && e !== 'input.pdf',
    );
    if (match) {
      return readFile(join(dir, match));
    }
    throw new LibreOfficeConversionError(
      `LibreOffice produced no output file (expected ${expectedName} in ${dir})`,
    );
  }
}

/** Valide que le buffer commence par les magic bytes attendus. */
function validateMagic(buf: Buffer, magic: Buffer, label: string): void {
  if (buf.length < magic.length) {
    throw new LibreOfficeConversionError(
      `LibreOffice output is too small (${buf.length} bytes) — conversion likely failed`,
    );
  }
  const head = buf.subarray(0, magic.length);
  if (!head.equals(magic)) {
    throw new LibreOfficeConversionError(
      `LibreOffice output does not start with ${label} magic (got 0x${head.toString('hex')})`,
    );
  }
}

/**
 * Exécute `soffice` avec les arguments fournis.
 * Résout en void sur exit code 0, rejette sinon.
 */
function runSoffice(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('soffice', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // spawn() échoue synchroniquement dans de rares cas — ENOENT remonte
      // normalement via l'événement 'error' ci-dessous.
      reject(new LibreOfficeUnavailableError());
      return;
    }

    let stderr = '';
    let stdout = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, SOFFICE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new LibreOfficeUnavailableError());
      } else {
        reject(err);
      }
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        reject(
          new LibreOfficeConversionError(
            `soffice timed out after ${SOFFICE_TIMEOUT_MS}ms`,
          ),
        );
        return;
      }

      if (code !== 0) {
        const combined = [stdout, stderr]
          .join('\n')
          .split('\n')
          .filter(Boolean)
          .slice(-5)
          .join(' | ');
        reject(
          new LibreOfficeConversionError(
            `soffice exited with code ${code}${combined ? `: ${combined}` : ''}`,
          ),
        );
        return;
      }

      resolve();
    });
  });
}
