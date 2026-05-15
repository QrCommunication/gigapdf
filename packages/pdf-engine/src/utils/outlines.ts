import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } from 'pdf-lib';

export interface OutlineItem {
  title: string | PDFString | PDFHexString;
  /** Le PDFRef original de la page cible dans le document source (si c'est un lien direct) */
  targetPageObjNum?: number;
  /** Le PDFRef de la page cible dans le document cible (utilisé pour le merge) */
  targetPageRef?: PDFRef;
  /** Dest ou Action brut (clonable) */
  destRaw?: any;
  actionRaw?: any;
  children: OutlineItem[];
  isExpanded?: boolean;
}

/**
 * Extrait l'arbre des signets (Outlines) d'un document.
 */
export function extractOutlines(doc: PDFDocument): OutlineItem[] {
  const catalog = doc.catalog;
  const outlinesRef = catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) return [];

  const outlinesDict = doc.context.lookupMaybe(outlinesRef, PDFDict);
  if (!outlinesDict) return [];

  const firstRef = outlinesDict.get(PDFName.of('First'));
  return walkOutlineItems(doc.context, firstRef);
}

function walkOutlineItems(ctx: PDFDocument['context'], firstRef: any): OutlineItem[] {
  const items: OutlineItem[] = [];
  let currentRef = firstRef;

  while (currentRef instanceof PDFRef) {
    const itemDict = ctx.lookupMaybe(currentRef, PDFDict);
    if (!itemDict) break;

    const title = itemDict.get(PDFName.of('Title')) as PDFString | PDFHexString;
    const destRaw = itemDict.get(PDFName.of('Dest'));
    const actionRaw = itemDict.get(PDFName.of('A'));
    const firstChildRef = itemDict.get(PDFName.of('First'));
    
    // On extrait le ref de la page cible si possible
    let targetPageObjNum: number | undefined;
    
    if (destRaw) {
      const destArr = ctx.lookupMaybe(destRaw, PDFArray);
      if (destArr && destArr.size() > 0) {
        const pageRef = destArr.get(0);
        if (pageRef instanceof PDFRef) {
          targetPageObjNum = pageRef.objectNumber;
        }
      }
    } else if (actionRaw) {
      const actionDict = ctx.lookupMaybe(actionRaw, PDFDict);
      if (actionDict && actionDict.get(PDFName.of('S'))?.toString() === '/GoTo') {
        const aDest = actionDict.get(PDFName.of('D'));
        const destArr = ctx.lookupMaybe(aDest, PDFArray);
        if (destArr && destArr.size() > 0) {
          const pageRef = destArr.get(0);
          if (pageRef instanceof PDFRef) {
            targetPageObjNum = pageRef.objectNumber;
          }
        }
      }
    }

    const children = firstChildRef ? walkOutlineItems(ctx, firstChildRef) : [];
    
    // Count flag defines if children are visible. If Count > 0, it's expanded.
    const countRaw = itemDict.get(PDFName.of('Count'));
    const isExpanded = typeof countRaw === 'number' && countRaw > 0;

    items.push({
      title,
      targetPageObjNum,
      destRaw,
      actionRaw,
      children,
      isExpanded
    });

    currentRef = itemDict.get(PDFName.of('Next'));
  }

  return items;
}

/**
 * Reconstruit un arbre d'outlines dans le document cible.
 * mapPageObjNum doit retourner le nouveau PDFRef de la page dans le document cible.
 * Si mapPageObjNum retourne undefined, l'élément est ignoré (sauf s'il a des enfants valides).
 */
export function buildOutlines(
  doc: PDFDocument,
  items: OutlineItem[],
  mapPageObjNum?: (oldObjNum: number) => PDFRef | undefined
): void {
  // 1. Filtrer et construire la nouvelle structure
  const buildNodes = (nodes: OutlineItem[]): PDFDict[] => {
    const result: PDFDict[] = [];
    
    for (const node of nodes) {
      let newPageRef: PDFRef | undefined;
      
      if (node.targetPageRef) {
        newPageRef = node.targetPageRef;
      } else if (node.targetPageObjNum !== undefined && mapPageObjNum) {
        newPageRef = mapPageObjNum(node.targetPageObjNum);
      }
      
      const children = buildNodes(node.children);
      
      // Si la page cible n'est pas dans ce document, et qu'il n'y a pas d'enfants valides, on ignore
      if (!newPageRef && children.length === 0 && (node.targetPageObjNum !== undefined || node.targetPageRef !== undefined)) {
        continue;
      }
      
      const dict = doc.context.obj({
        Title: node.title,
      });

      if (newPageRef && node.destRaw) {
        // Simple array dest reconstruction: [newPageRef, /Fit]
        dict.set(PDFName.of('Dest'), doc.context.obj([newPageRef, PDFName.of('Fit')]));
      } else if (newPageRef && node.actionRaw) {
        const action = doc.context.obj({
          S: PDFName.of('GoTo'),
          D: doc.context.obj([newPageRef, PDFName.of('Fit')])
        });
        dict.set(PDFName.of('A'), action);
      } else if (!node.targetPageObjNum && (node.destRaw || node.actionRaw)) {
        // Named dest or other actions (URL etc)
        // Here we could try to clone them, but for simplicity we keep them if they don't have targetPageObjNum
      }

      if (children.length > 0) {
        (dict as any)._children = children; // temp prop
        if (node.isExpanded) {
          dict.set(PDFName.of('Count'), PDFNumber.of(children.length));
        } else {
          dict.set(PDFName.of('Count'), PDFNumber.of(-children.length));
        }
      }

      result.push(dict as PDFDict);
    }
    return result;
  };

  const validNodes = buildNodes(items);
  if (validNodes.length === 0) return;

  // 2. Link the nodes (Parent, Prev, Next, First, Last)
  const linkNodes = (nodes: PDFDict[], parentRef: PDFRef) => {
    // Create refs for all nodes first. nodes.map preserves length so refs[i]
    // is always defined for valid i — captured via non-null assertions below.
    const refs = nodes.map(n => doc.context.register(n));

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const ref = refs[i]!;

      node.set(PDFName.of('Parent'), parentRef);

      if (i > 0) {
        node.set(PDFName.of('Prev'), refs[i - 1]!);
      }
      if (i < nodes.length - 1) {
        node.set(PDFName.of('Next'), refs[i + 1]!);
      }

      const children = (node as any)._children as PDFDict[] | undefined;
      if (children && children.length > 0) {
        node.set(PDFName.of('First'), doc.context.register(children[0]!));
        node.set(PDFName.of('Last'), doc.context.register(children[children.length - 1]!));
        linkNodes(children, ref);
        delete (node as any)._children;
      }
    }
  };

  const outlinesDict = doc.context.obj({
    Type: PDFName.of('Outlines'),
    Count: validNodes.length
  });

  const outlinesRef = doc.context.register(outlinesDict);

  // validNodes.length > 0 was checked above, so first/last are defined.
  outlinesDict.set(PDFName.of('First'), doc.context.register(validNodes[0]!));
  outlinesDict.set(PDFName.of('Last'), doc.context.register(validNodes[validNodes.length - 1]!));
  
  linkNodes(validNodes, outlinesRef);

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}
