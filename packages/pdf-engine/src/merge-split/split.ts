/**
 * split.ts — Découpe un PDF en plusieurs chunks via pdf-lib.
 *
 * ## Stratégie de remapping post-copyPages
 *
 * pdf-lib `copyPages()` copie les pages structurellement mais laisse trois
 * catégories de références pendantes dans chaque chunk :
 *
 * ### Fix 1 — GoTo /D annotation remapping
 * Les annotations Link portant une action GoTo (ou un dest direct) contiennent
 * un tableau [pageRef, /XYZ, ...]. Le `pageRef` est l'objet PDFRef de la page
 * ORIGINALE. Après copyPages ce ref est inexistant dans le xref du chunk.
 * On itère sur toutes les annotations de chaque page copiée :
 *   - Si la page destination est dans ce chunk → on remplace le PDFRef par
 *     celui de la page copiée correspondante dans le chunk.
 *   - Si la page destination est hors chunk → on supprime l'annotation
 *     (conservative : un lien cassé est pire qu'un lien absent).
 *
 * ### Fix 2 — AcroForm /Fields re-registration
 * copyPages ne transfère pas le catalogue AcroForm. On parcourt les fields du
 * source, on identifie les widgets dont la page (/P back-pointer) appartient
 * au chunk, et on les ajoute au AcroForm du nouveau document.
 * Pour les fields multi-page dont seuls certains widgets sont dans le chunk,
 * seuls les widgets in-chunk sont inclus.
 *
 * ### Fix 3 — Named /Dests catalog
 * Le catalogue /Dests (dictionnaire nom → [pageRef, /XYZ, ...]) est perdu
 * lors du copyPages. On le recrée en filtrant uniquement les destinations
 * dont la page cible est dans ce chunk, avec le nouveau PDFRef.
 */

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
} from 'pdf-lib';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import type { PageRange } from '../utils/page-range';
import { extractOutlines, buildOutlines } from '../utils/outlines';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Construit une Map : objectNumber de la page source → index 0-based dans
 * le tableau des pages copiées (le chunk).
 *
 * pdf-lib `context.getObjectRef(page.node)` retourne le PDFRef de la page
 * dans le context SOURCE. On associe ce numéro d'objet à sa position dans
 * pageIndices pour pouvoir remapper rapidement.
 */
function buildSourcePageObjNumToChunkIndex(
  sourceDoc: PDFDocument,
  pageIndices: number[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < pageIndices.length; i++) {
    const srcIdx = pageIndices[i]!;
    const srcPage = sourceDoc.getPage(srcIdx);
    const srcRef = sourceDoc.context.getObjectRef(srcPage.node);
    if (srcRef) {
      map.set(srcRef.objectNumber, i);
    }
  }
  return map;
}

/**
 * Extrait le tableau de destination GoTo d'une annotation dict.
 *
 * Selon la spec PDF, la destination peut être :
 *   - Dans /A (action GoTo) → dict { /S /GoTo, /D <array|name> }
 *   - Directement dans /Dest → <array|name>
 *
 * Retourne le PDFArray de destination ou undefined si non applicable.
 */
function extractGotoDestArray(
  ctx: PDFDocument['context'],
  annotDict: PDFDict,
): PDFArray | undefined {
  // Chemin 1 : /A → action GoTo → /D array
  const aRaw = annotDict.get(PDFName.of('A'));
  if (aRaw) {
    const actionDict = ctx.lookupMaybe(aRaw, PDFDict);
    if (actionDict) {
      const sRaw = actionDict.get(PDFName.of('S'));
      if (sRaw?.toString() === '/GoTo') {
        const dRaw = actionDict.get(PDFName.of('D'));
        if (dRaw) {
          return ctx.lookupMaybe(dRaw, PDFArray);
        }
      }
    }
  }

  // Chemin 2 : /Dest direct (peut être un array ou une PDFString de named dest)
  const destRaw = annotDict.get(PDFName.of('Dest'));
  if (destRaw) {
    // Les PDFString/PDFHexString indiquent un named dest (résolu via /Dests, Fix 3).
    // On ne les traite pas ici pour éviter un throw dans lookupMaybe.
    if (destRaw instanceof PDFArray) return destRaw;
    // Tenter une résolution de ref → array si ce n'est pas un string
    try {
      return ctx.lookupMaybe(destRaw, PDFArray);
    } catch {
      // String ou type inattendu — ignorer silencieusement
      return undefined;
    }
  }

  return undefined;
}

/**
 * Fix 1 — Reprocesse les annotations Link/GoTo de chaque page du chunk.
 *
 * Pour chaque annotation dont la destination est un tableau [pageRef, ...] :
 *   - Si pageRef est une page IN-chunk → remplace par le nouveau PDFRef
 *     (celui enregistré dans chunkDoc.context pour la page copiée).
 *   - Si pageRef est hors-chunk → supprime l'annotation du tableau /Annots.
 *
 * Les annotations utilisant un nom de destination (string /Dest) ne sont pas
 * touchées ici — elles sont résolues via la table /Dests (Fix 3).
 */
function remapOrDropGotoAnnotations(
  chunkDoc: PDFDocument,
  copiedPageRefs: PDFRef[],
  srcObjNumToChunkIdx: Map<number, number>,
): void {
  for (let pageIdx = 0; pageIdx < copiedPageRefs.length; pageIdx++) {
    const chunkPage = chunkDoc.getPage(pageIdx);
    const annotsRaw = chunkPage.node.get(PDFName.of('Annots'));
    if (!annotsRaw) continue;

    const annotsArr = chunkDoc.context.lookupMaybe(annotsRaw, PDFArray);
    if (!annotsArr) continue;

    const keepIndices: number[] = [];

    for (let ai = 0; ai < annotsArr.size(); ai++) {
      const annotItemRaw = annotsArr.get(ai);
      const annotDict = chunkDoc.context.lookupMaybe(annotItemRaw, PDFDict);
      if (!annotDict) {
        keepIndices.push(ai);
        continue;
      }

      // Vérifier que c'est bien un Link
      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (subtype?.toString() !== '/Link') {
        keepIndices.push(ai);
        continue;
      }

      // Chercher un dest array GoTo
      const destArr = extractGotoDestArray(chunkDoc.context, annotDict);
      if (!destArr) {
        // Pas de GoTo array → conserver tel quel
        keepIndices.push(ai);
        continue;
      }

      // Le premier élément du dest array doit être un PDFRef (page)
      const firstElem = destArr.get(0);
      if (!(firstElem instanceof PDFRef)) {
        // Dest de type nom ou autre — pas touché ici
        keepIndices.push(ai);
        continue;
      }

      // firstElem est un PDFRef vers une page SOURCE
      const srcObjNum = firstElem.objectNumber;
      const chunkIdx = srcObjNumToChunkIdx.get(srcObjNum);

      if (chunkIdx !== undefined) {
        // Page destination est dans ce chunk → remapper vers le nouveau ref
        const newPageRef = copiedPageRefs[chunkIdx]!;
        destArr.set(0, newPageRef);
      } else {
        // Page destination hors chunk → neutraliser l'action GoTo de l'annotation.
        // On conserve l'annotation dans /Annots (pour ne pas casser la structure
        // de la page) mais on supprime l'action /A et l'éventuel /Dest direct
        // afin d'éviter un dangling ref. L'annotation devient inerte (pas de lien).
        annotDict.delete(PDFName.of('A'));
        annotDict.delete(PDFName.of('Dest'));
      }
      keepIndices.push(ai);
    }

    // Reconstruire /Annots si nécessaire (rien à supprimer dans cette stratégie,
    // mais on laisse le code intact au cas où d'autres chemins ajouteraient des drops)
    if (keepIndices.length === annotsArr.size()) {
      continue;
    }

    if (keepIndices.length === 0) {
      chunkPage.node.delete(PDFName.of('Annots'));
    } else {
      const newAnnots = chunkDoc.context.obj(
        keepIndices.map((i) => annotsArr.get(i)),
      );
      chunkPage.node.set(PDFName.of('Annots'), newAnnots);
    }
  }
}

/**
 * Fix 2 — AcroForm /Fields re-registration.
 *
 * Si le document source a un AcroForm, on identifie les fields (et leurs
 * widgets) dont la page `/P` est dans ce chunk, et on les enregistre dans
 * le catalogue AcroForm du chunk.
 *
 * La logique tolère les fields multi-page : si un field a des widgets sur
 * plusieurs pages et que seuls certains sont dans le chunk, seuls ceux-là
 * sont inclus. Les fields sans aucun widget dans le chunk sont omis.
 *
 * Note : on utilise les PDFRef de chunkDoc (remappés par copyPages via
 * PDFObjectCopier) pour identifier les widgets — les Annots ont déjà été
 * copiés avec les pages, donc leurs objets existent dans chunkDoc.context.
 */
function reregisterAcroFormFields(
  sourceDoc: PDFDocument,
  chunkDoc: PDFDocument,
  srcObjNumToChunkIdx: Map<number, number>,
): void {
  const srcAcroForm = sourceDoc.catalog.getAcroForm();
  if (!srcAcroForm) return;

  // Construire le set des objNumbers de pages qui sont dans ce chunk (source side)
  const inChunkSrcObjNums = new Set(srcObjNumToChunkIdx.keys());

  // Récupérer (ou créer) l'AcroForm du chunk
  const chunkAcroForm = chunkDoc.catalog.getOrCreateAcroForm();

  // Copier les propriétés globales de l'AcroForm (DR, DA, Q, etc.) sauf /Fields
  const srcAcroFormDict = srcAcroForm.dict;
  for (const [key, value] of srcAcroFormDict.entries()) {
    const keyName = key.toString();
    if (keyName === '/Fields') continue;
    // Cloner la valeur dans le context du chunk
    try {
      const clonedValue = value.clone(chunkDoc.context);
      chunkAcroForm.dict.set(key as PDFName, clonedValue);
    } catch {
      // Ignorer les clones qui échouent (streams, refs complexes)
    }
  }

  // Itérer sur tous les fields du source AcroForm
  const allFields = srcAcroForm.getAllFields();

  for (const [fieldModel, fieldRef] of allFields) {
    const kids = fieldModel.Kids();
    const hasWidgetKids = kids && kids.size() > 0;

    if (hasWidgetKids) {
      // Field avec des enfants (widgets). Vérifier si des widgets sont in-chunk
      // via leur /P (page back-pointer dans le source context)
      const inChunkWidgetRefs: PDFRef[] = [];

      for (let ki = 0; ki < kids.size(); ki++) {
        const kidRef = kids.get(ki);
        if (!(kidRef instanceof PDFRef)) continue;
        const kidDict = sourceDoc.context.lookupMaybe(kidRef, PDFDict);
        if (!kidDict) continue;

        // Lire /P (page ref dans le source)
        const pRaw = kidDict.get(PDFName.of('P'));
        if (pRaw instanceof PDFRef && inChunkSrcObjNums.has(pRaw.objectNumber)) {
          // Ce widget est sur une page du chunk
          // On cherche le PDFRef correspondant dans le chunkDoc context
          // (le copier l'a enregistré sous un nouveau ref)
          const chunkKidDict = findCopiedDict(chunkDoc, kidDict, kidRef);
          if (chunkKidDict) {
            inChunkWidgetRefs.push(chunkKidDict);
          }
        }
      }

      if (inChunkWidgetRefs.length > 0) {
        // Ajouter le field (ou un wrapper) dans le AcroForm du chunk
        // On utilise le fieldRef copié s'il existe dans chunkDoc, sinon on
        // crée une entrée directe pour les widgets
        for (const widgetRef of inChunkWidgetRefs) {
          chunkAcroForm.addField(widgetRef);
        }
      }
    } else {
      // Field sans Kids → le field lui-même est un widget
      // Vérifier /P
      const pRaw = fieldModel.dict.get(PDFName.of('P'));
      if (pRaw instanceof PDFRef && inChunkSrcObjNums.has(pRaw.objectNumber)) {
        // Chercher le dict copié dans chunkDoc
        const chunkFieldRef = findCopiedDict(chunkDoc, fieldModel.dict, fieldRef);
        if (chunkFieldRef) {
          chunkAcroForm.addField(chunkFieldRef);
        }
      }
    }
  }
}

/**
 * Cherche dans chunkDoc.context le PDFRef correspondant à un dict copié
 * depuis sourceDoc. On ne peut pas faire une correspondance directe par ref
 * (les refs changent après copy), donc on recherche par identité d'objet dans
 * la Map traversedObjects — celle-ci n'est pas exposée. À la place, on
 * parcourt les Annots des pages du chunk pour trouver le widget par son /T
 * (nom de field) ou sa /Rect, ou on fait un lookup par position dans les Annots.
 *
 * Stratégie pragmatique : chercher dans indirectObjects du chunkDoc un PDFDict
 * qui a été enregistré et qui correspond (par la valeur /T ou /Rect) au dict source.
 * On retourne le PDFRef du premier match.
 */
function findCopiedDict(
  chunkDoc: PDFDocument,
  srcDict: PDFDict,
  _srcRef: PDFRef,
): PDFRef | undefined {
  // Extraire les clés discriminantes du dict source
  const srcT = srcDict.get(PDFName.of('T'));
  const srcRect = srcDict.get(PDFName.of('Rect'));

  const entries = chunkDoc.context.enumerateIndirectObjects();
  for (const [ref, obj] of entries) {
    if (!(obj instanceof PDFDict)) continue;

    // Match par /T (nom du field) si présent
    if (srcT) {
      const objT = obj.get(PDFName.of('T'));
      if (objT && objT.toString() === srcT.toString()) {
        return ref;
      }
    }

    // Match par /Rect si présent (widget)
    if (srcRect && !srcT) {
      const objRect = obj.get(PDFName.of('Rect'));
      if (objRect && objRect.toString() === srcRect.toString()) {
        return ref;
      }
    }
  }

  return undefined;
}

/**
 * Fix 3 — Named /Dests catalog remapping.
 *
 * Si le catalog source contient /Dests (dictionnaire nom → [pageRef, ...]),
 * on recrée ce dictionnaire dans le chunk en ne conservant que les entrées
 * dont la page destination est dans le chunk, avec la nouvelle PDFRef.
 *
 * Note : les /Names /Dests (name tree) ne sont pas couverts ici (structure
 * plus complexe, rarement utilisée dans les PDFs non-outlinés).
 */
function remapNamedDests(
  sourceDoc: PDFDocument,
  chunkDoc: PDFDocument,
  copiedPageRefs: PDFRef[],
  srcObjNumToChunkIdx: Map<number, number>,
): void {
  const srcDestsRaw = sourceDoc.catalog.get(PDFName.of('Dests'));
  if (!srcDestsRaw) return;

  const srcDestsDict = sourceDoc.context.lookupMaybe(srcDestsRaw, PDFDict);
  if (!srcDestsDict) return;

  const newDestsEntries: Array<[string, unknown]> = [];

  for (const [nameKey, destValue] of srcDestsDict.entries()) {
    // destValue peut être un array direct ou une ref vers un array
    const destArr = sourceDoc.context.lookupMaybe(destValue, PDFArray);
    if (!destArr) continue;

    // Premier élément = PDFRef vers la page source
    const pageRefRaw = destArr.get(0);
    if (!(pageRefRaw instanceof PDFRef)) continue;

    const chunkIdx = srcObjNumToChunkIdx.get(pageRefRaw.objectNumber);
    if (chunkIdx === undefined) continue; // Page hors chunk → on omet

    // Reconstruire le dest array avec le nouveau PDFRef de page
    const newPageRef = copiedPageRefs[chunkIdx]!;

    // Copier les éléments restants du dest array [pageRef, /XYZ, x, y, zoom]
    const newDestElements: unknown[] = [newPageRef];
    for (let i = 1; i < destArr.size(); i++) {
      newDestElements.push(destArr.get(i));
    }

    const newDestArr = chunkDoc.context.obj(newDestElements as Parameters<typeof chunkDoc.context.obj>[0]);
    newDestsEntries.push([nameKey.toString().replace(/^\//, ''), newDestArr]);
  }

  if (newDestsEntries.length === 0) return;

  // Construire le nouveau /Dests dict
  const newDestsObj: Record<string, unknown> = {};
  for (const [name, arr] of newDestsEntries) {
    newDestsObj[name] = arr;
  }

  const newDestsDict = chunkDoc.context.obj(newDestsObj as Parameters<typeof chunkDoc.context.obj>[0]);
  chunkDoc.catalog.set(PDFName.of('Dests'), newDestsDict);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadSource(buffer: Buffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function splitPDF(buffer: Buffer, ranges: PageRange[]): Promise<Buffer[]> {
  const sourceDoc = await loadSource(buffer);
  const pageCount = sourceDoc.getPageCount();

  for (const range of ranges) {
    if (range.start < 1) {
      throw new PDFPageOutOfRangeError(range.start, pageCount);
    }
    if (range.end > pageCount) {
      throw new PDFPageOutOfRangeError(range.end, pageCount);
    }
    if (range.start > range.end) {
      throw new PDFParseError(
        `Invalid range: start (${range.start}) must be less than or equal to end (${range.end})`,
      );
    }
  }

  const results: Buffer[] = [];

  for (const range of ranges) {
    const doc = await PDFDocument.create();
    const pageIndices: number[] = [];
    for (let p = range.start - 1; p <= range.end - 1; p++) {
      pageIndices.push(p);
    }

    // Construire la map AVANT copyPages (les refs de pages source sont stables)
    const srcObjNumToChunkIdx = buildSourcePageObjNumToChunkIndex(sourceDoc, pageIndices);

    const copiedPages = await doc.copyPages(sourceDoc, pageIndices);
    for (const copiedPage of copiedPages) {
      doc.addPage(copiedPage);
    }

    // Récupérer les PDFRef des pages copiées dans le nouveau document
    const copiedPageRefs: PDFRef[] = doc.getPages().map((p) => {
      const ref = doc.context.getObjectRef(p.node);
      if (!ref) {
        throw new PDFParseError('Internal: copied page has no ref in chunk context');
      }
      return ref;
    });

    // Fix 1 — Remapper ou supprimer les annotations GoTo avec dest hors-chunk
    remapOrDropGotoAnnotations(doc, copiedPageRefs, srcObjNumToChunkIdx);

    // Fix 2 — Réenregistrer les AcroForm fields dont les widgets sont dans ce chunk
    reregisterAcroFormFields(sourceDoc, doc, srcObjNumToChunkIdx);

    // Fix 3 — Remapper les named destinations /Dests du catalog
    remapNamedDests(sourceDoc, doc, copiedPageRefs, srcObjNumToChunkIdx);

    // Fix 4 — Reconstruire les Outlines (Sommaire) du document
    const sourceOutlines = extractOutlines(sourceDoc);
    if (sourceOutlines.length > 0) {
      buildOutlines(doc, sourceOutlines, (oldObjNum) => {
        const chunkIdx = srcObjNumToChunkIdx.get(oldObjNum);
        return chunkIdx !== undefined ? copiedPageRefs[chunkIdx] : undefined;
      });
    }

    const bytes = await doc.save({ useObjectStreams: true });
    results.push(Buffer.from(bytes));
  }

  return results;
}

export async function splitAt(buffer: Buffer, splitPoints: number[]): Promise<Buffer[]> {
  const sourceDoc = await loadSource(buffer);
  const pageCount = sourceDoc.getPageCount();

  const sorted = [...new Set(splitPoints)].sort((a, b) => a - b);

  const ranges: PageRange[] = [];

  if (sorted.length === 0) {
    ranges.push({ start: 1, end: pageCount });
  } else {
    ranges.push({ start: 1, end: sorted[0]! });
    for (let i = 1; i < sorted.length; i++) {
      ranges.push({ start: sorted[i - 1]! + 1, end: sorted[i]! });
    }
    ranges.push({ start: sorted[sorted.length - 1]! + 1, end: pageCount });
  }

  return splitPDF(buffer, ranges);
}
