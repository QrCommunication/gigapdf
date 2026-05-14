# Plan de Tests Round-Trip — Fidélité Save/Reload PDF

**Session:** SESSION_20260421_gigapdf_audit  
**Date:** 2026-04-21  
**Scope:** Validation fidélité pipeline edit → save → reload avant merge Wave 2 fonts  
**Auteur:** qa-testing agent

---

## 1. Couverture de Tests Actuelle

### 1.1 Tests existants (packages/pdf-engine/__tests__)

| Suite | Fichier | Ce qui est couvert | Ce qui manque |
|---|---|---|---|
| `document-handle.test.ts` | engine/ | open/save/close/metadata/dimensions, round-trip metadata | Round-trip avec polices embarquées, GC fonts, concurrent save |
| `text-renderer.test.ts` | render/ | addText/updateText happy path + errors | Pas de test originalFont, pas de re-parse après save pour vérifier la police |
| `font-map.test.ts` | utils/ | normalizeFontName + mapPdfFontToStandard exhaustif | Pas de test pour fonts non-standards (CID, TTF subset) |
| `parser.test.ts` | parse/ | parseDocument/parsePage/parseMetadata/parseBookmarks | Aucun fixture avec polices embarquées ; `fonts[]` champ non testé |
| `text-extractor.test.ts` | parse/ | Extraction texte basique | Pas de test `originalFont` propagé |
| `image-extractor.test.ts` | parse/ | — | Pas de test compression préservée après save |
| `form-extractor.test.ts` | parse/ | Extraction champs AcroForm | Pas de test interactivité après save |
| `annotation-extractor.test.ts` | parse/ | — | Pas de test persistance après save |
| `page-ops.test.ts` | engine/ | — | Pas de test pages non touchées (100+ pages) |

**Fixtures disponibles :** simple.pdf, multi-page.pdf, with-forms.pdf, encrypted-placeholder.pdf, landscape.pdf  
**Fixtures MANQUANTES :** embedded-fonts.pdf, signed-padesbasic.pdf, password-protected.pdf, large-100pages.pdf, with-images-compressed.pdf, with-ocg-layers.pdf

### 1.2 Tests existants (Python / FastAPI — tests/)

| Suite | Fichier | Ce qui est couvert | Ce qui manque |
|---|---|---|---|
| `test_api_health.py` | integration/ | GET /health | — |
| `test_websocket_collaboration.py` | integration/ | WebSocket echo | — |
| `test_api_keys.py` | integration/ | CRUD API keys | — |
| `test_helpers.py` | unit/ | Fonctions utilitaires | — |
| `test_coordinates.py` | unit/ | Coordonnées | — |

**Gap total Python :** Zéro test sur les endpoints PDF critiques (`/api/v1/storage/documents`, `/api/pdf/apply-elements`, `/api/pdf/save`, `/api/pdf/open`).

### 1.3 Tests existants (embed SDK)

| Suite | Ce qui est couvert | Ce qui manque |
|---|---|---|
| `gigapdf-editor.test.ts` | URL construction, postMessage happy path | Fonts chargement dans iframe, CORS, `ready` timing |

### 1.4 Gaps critiques identifiés (priorité décroissante)

1. **CRITIQUE** — Aucun test d'intégration `apply-elements` qui vérifie la police après re-parse : la régression Helvetica fallback est silencieuse en prod
2. **CRITIQUE** — Aucun test `saveDocument(garbage=X)` qui vérifie que les polices embarquées survivent
3. **CRITIQUE** — Aucun test du hook `useDocumentSave` pour la race condition `immediate` vs debounce
4. **HAUT** — Aucune fixture PDF avec polices CID/TTF subset
5. **HAUT** — Aucun test E2E Playwright (répertoire `tests/e2e/` absent)
6. **MOYEN** — `originalFont` non propagé dans `apply-elements/route.ts` et non testé
7. **MOYEN** — Aucun test Python pour le chiffrement AES-256-GCM round-trip

---

## 2. Scénarios de Test Round-Trip

> Notation : **INPUT** → **ACTION** → **EXPECTED OUTPUT** → **VALIDATION**

---

### S1 — PDF simple Helvetica → ajout texte → save → reload → fidélité

**Priorité :** HAUTE (régression basique, doit passer avant tout merge)

**INPUT :**
- `simple.pdf` (fixture existante) — Helvetica standard, 1 page

**ACTION :**
1. `openDocument(buffer)`
2. `addText(handle, 1, { content: "Texte ajouté", style: { fontFamily: "helvetica", fontSize: 14 } })`
3. `saveDocument(handle, { garbage: 0 })`
4. `openDocument(savedBytes)` → `parsePage(savedBytes, 1)`

**EXPECTED OUTPUT :**
- La page reouverte contient exactement les éléments texte originaux + le nouveau texte
- La police du texte original reste "Helvetica" dans les éléments extraits
- Le texte ajouté est lisible, police Helvetica
- `savedBytes.length >= originalBytes.length`

**VALIDATION PROGRAMMATIQUE :**
```typescript
const originalDoc = await parseDocument(originalBuffer);
const originalTextCount = originalDoc.pages[0].elements.filter(e => e.type === 'text').length;

// Apply + save
const handle = await openDocument(originalBuffer);
await addText(handle, 1, newTextElement);
const savedBytes = await saveDocument(handle);

// Re-parse
const savedDoc = await parseDocument(savedBytes);
const savedPage = savedDoc.pages[0];
const textElements = savedPage.elements.filter(e => e.type === 'text');

expect(textElements).toHaveLength(originalTextCount + 1);
expect(textElements.some(e => e.content.includes('Texte ajouté'))).toBe(true);
// Police préservée
const originalTexts = textElements.filter(e => !e.content.includes('Texte ajouté'));
originalTexts.forEach(e => {
  expect((e as TextElement).style.fontFamily.toLowerCase()).toContain('helvetica');
});
```

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s1-helvetica-roundtrip.test.ts`

---

### S2 — PDF police custom (Arial/Calibri subset) → édition → save → reload → police préservée

**Priorité :** CRITIQUE (régression active en production via font-map.ts:46 fallback)

**INPUT :**
- `embedded-fonts.pdf` (fixture à créer) — contient au moins :
  - 1 texte avec police CID "CalibriRegular" (TTF subset)
  - 1 texte avec police "ArialMT" (TTF non-subset)
  - 1 texte Helvetica standard (référence)

**ACTION :**
1. `parseDocument(buffer)` → récupérer `elements[0]` texte avec CalibriRegular
2. `openDocument(buffer)` + `updateText(handle, 1, oldBounds, modifiedElement)` où `modifiedElement.style.originalFont = "CalibriRegular"`
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → inspecter police du texte

**EXPECTED OUTPUT :**
- Après save, le texte modifié a `style.fontFamily` qui n'est PAS "Helvetica"
- `style.originalFont === "CalibriRegular"` ou équivalent
- Les polices non éditées (Helvetica, ArialMT) restent inchangées
- La taille du fichier sauvegardé est >= à l'original (polices embarquées préservées)

**VALIDATION PROGRAMMATIQUE :**
```typescript
// Vérifier que la police embedded survit au save
const savedDoc = await parseDocument(savedBytes);
const editedElement = savedDoc.pages[0].elements
  .filter(e => e.type === 'text')
  .find(e => (e as TextElement).content === 'Texte modifié') as TextElement;

// DOIT ÉCHOUER avant le fix Wave 2 (régression documentée)
// DOIT PASSER après le fix
expect(editedElement?.style.originalFont).toBe('CalibriRegular');
expect(editedElement?.style.fontFamily.toLowerCase()).not.toBe('helvetica');

// Vérifier que le PDF n'a pas perdu la table de polices
expect(savedBytes.length).toBeGreaterThanOrEqual(originalBuffer.length * 0.9);
```

**NOTE DE RÉGRESSION :** Ce test DOIT être marqué `.fails()` sur `main` actuel et `.passes()` après le merge Wave 2. C'est le test de non-régression officiel de la Wave 2.

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s2-embedded-font-roundtrip.test.ts`

---

### S3 — PDF AcroForm → remplir → save → reload → interactivité conservée

**Priorité :** HAUTE

**INPUT :**
- `with-forms.pdf` (fixture existante) — 4 champs (name, email, checkbox, dropdown)

**ACTION :**
1. `openDocument(buffer)` — vérifier que les 4 champs sont présents
2. Remplir via `applyElements` avec opérations `update` sur `form_field`
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → compter les champs + vérifier valeurs

**EXPECTED OUTPUT :**
- Le PDF réouvert contient toujours 4 champs AcroForm
- Les valeurs saisies sont persistées
- Les types de champs (text, checkbox, dropdown) sont conservés
- `doc.metadata.hasForm === true` (ou équivalent)

**VALIDATION PROGRAMMATIQUE :**
```typescript
const savedDoc = await parseDocument(savedBytes);
const formFields = savedDoc.pages[0].elements.filter(e => e.type === 'form_field');
expect(formFields).toHaveLength(4);

const nameField = formFields.find(f => (f as FormFieldElement).name === 'name') as FormFieldElement;
expect(nameField?.value).toBe('Test User'); // valeur saisie
```

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s3-acroform-roundtrip.test.ts`

---

### S4 — PDF signé PAdES → édition → save → signature invalidée (comportement attendu)

**Priorité :** MOYENNE (documenter le comportement, pas un bug)

**INPUT :**
- `signed-padesbasic.pdf` (fixture à créer via pyHanko ou fixture réelle)

**ACTION :**
1. `parseDocument(buffer)` → vérifier présence annotation signature
2. `openDocument(buffer)` + `addText(handle, 1, someTextElement)`
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → inspecter annotations

**EXPECTED OUTPUT :**
- Le PDF s'ouvre sans erreur après édition
- La signature PAdES est présente dans les annotations mais `isValid === false` (ou marquée comme modifiée)
- Aucune exception n'est levée (comportement gracieux)

**NOTE :** Ce scénario valide que GigaPDF ne prétend pas maintenir la validité des signatures. Le comportement attendu est l'invalidation.

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s4-signed-pdf-roundtrip.test.ts`

---

### S5 — PDF protégé mot de passe → édition → save → chiffrement préservé

**Priorité :** MOYENNE

**INPUT :**
- `password-protected.pdf` (fixture à créer avec node-forge ou PyPDF2 — mot de passe : "test123")

**ACTION :**
1. `openDocument(buffer, { password: "test123" })` → doit réussir
2. Édition quelconque
3. `saveDocument(handle)` → bytes sauvegardés

**EXPECTED OUTPUT :**
- Sans le mot de passe, `openDocument(savedBytes)` doit lever `PDFEncryptedError`
- Avec le bon mot de passe, le document s'ouvre et l'édition est présente

**NOTE ACTUELLE :** `openDocument` lance `PDFInvalidPasswordError` pour tout PDF chiffré car pdf-lib ne supporte pas le déchiffrement. Ce test documente le comportement actuel et doit être adapté quand le support du déchiffrement sera ajouté.

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s5-password-pdf-roundtrip.test.ts`

---

### S6 — PDF 100+ pages → édition page 50 → save → pages non touchées intactes

**Priorité :** HAUTE (regression integrity pour les gros documents)

**INPUT :**
- `large-100pages.pdf` (fixture à créer programmatiquement — 100 pages avec texte "Page N")

**ACTION :**
1. `openDocument(buffer)`
2. `addText(handle, 50, { content: "Modification page 50", ... })`
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → vérifier toutes les pages

**EXPECTED OUTPUT :**
- `savedDoc.metadata.pageCount === 100`
- Page 50 contient le nouveau texte + les textes originaux
- Pages 1-49 et 51-100 sont identiques à l'original (même contenu texte)
- `savedBytes.length` est proche de l'original (pas de duplication massive)

**VALIDATION PROGRAMMATIQUE :**
```typescript
const savedDoc = await parseDocument(savedBytes);
expect(savedDoc.metadata.pageCount).toBe(100);

// Pages non touchées
for (const pageNum of [1, 25, 49, 51, 75, 100]) {
  const page = savedDoc.pages.find(p => p.pageNumber === pageNum)!;
  const texts = page.elements.filter(e => e.type === 'text').map(e => (e as TextElement).content);
  expect(texts.some(t => t.includes(`Page ${pageNum}`))).toBe(true);
  expect(texts.some(t => t.includes('Modification page 50'))).toBe(false);
}

// Page modifiée
const page50 = savedDoc.pages.find(p => p.pageNumber === 50)!;
expect(page50.elements.some(e => (e as TextElement).content?.includes('Modification page 50'))).toBe(true);
```

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s6-large-pdf-roundtrip.test.ts`

---

### S7 — PDF images → édition texte → save → compression images préservée

**Priorité :** MOYENNE

**INPUT :**
- `with-images-compressed.pdf` (fixture à créer — 1 image JPEG compressée)

**ACTION :**
1. `openDocument(buffer)`
2. `addText(handle, 1, someTextElement)` (édition texte seul, pas d'image)
3. `saveDocument(handle, { garbage: 0 })`
4. Comparer les bytes image dans l'original vs sauvegardé

**EXPECTED OUTPUT :**
- La taille du fichier sauvegardé ne dépasse pas `originalSize * 1.2` (20% de marge pour les métadonnées)
- Les images extraites de `savedDoc` ont les mêmes dimensions et type MIME qu'avant
- Pas de re-compression accidentelle des images (qui dégraderait la qualité)

**VALIDATION PROGRAMMATIQUE :**
```typescript
expect(savedBytes.length).toBeLessThan(originalBuffer.length * 1.2);

const savedImages = savedDoc.pages[0].elements.filter(e => e.type === 'image');
const originalImages = originalDoc.pages[0].elements.filter(e => e.type === 'image');
expect(savedImages).toHaveLength(originalImages.length);
```

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s7-images-roundtrip.test.ts`

---

### S8 — PDF calques OCG → édition → save → calques préservés

**Priorité :** BASSE (feature avancée, peu utilisée)

**INPUT :**
- `with-ocg-layers.pdf` (fixture à créer avec couches optionnelles de contenu)

**ACTION :**
1. `parseDocument(buffer)` → vérifier `doc.layers.length > 0`
2. `openDocument(buffer)` + édition texte sur page 1
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → vérifier calques

**EXPECTED OUTPUT :**
- `savedDoc.layers` a le même nombre d'entrées que l'original
- Les noms des calques sont préservés
- La visibilité par défaut de chaque calque est identique

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s8-ocg-layers-roundtrip.test.ts`

---

### S9 — PDF annotations → ajout annotation → save → persistées

**Priorité :** HAUTE

**INPUT :**
- `simple.pdf` (fixture existante) — sans annotations préexistantes

**ACTION :**
1. `openDocument(buffer)`
2. `addAnnotation(handle, 1, { type: 'annotation', subtype: 'highlight', bounds: {x:50,y:700,w:200,h:20}, content: 'Test note' })`
3. `saveDocument(handle, { garbage: 0 })`
4. `parseDocument(savedBytes)` → vérifier annotations

**EXPECTED OUTPUT :**
- `savedDoc.pages[0].elements.filter(e => e.type === 'annotation').length === 1`
- L'annotation a le bon `subtype` et `content`
- Coordonnées préservées (±1px de tolérance pour les arrondis)

**Fichier cible :** `packages/pdf-engine/__tests__/roundtrip/s9-annotations-roundtrip.test.ts`

---

### S10 — Édition rapide debounce → save → pas de data loss

**Priorité :** CRITIQUE (race condition documentée dans useDocumentSave)

**INPUT :**
- Hook `useDocumentSave` + mock API (`api.saveDocument`, `api.createDocumentVersion`)

**ACTION :**
1. Monter le hook avec `debounceDelay: 100`
2. Appeler `saveWithPriority('immediate')` — déclenche une sauvegarde
3. PENDANT que la sauvegarde est en cours, appeler `saveWithPriority('immediate')` une seconde fois
4. Attendre la résolution des deux appels

**EXPECTED OUTPUT :**
- La seconde sauvegarde N'EST PAS silencieusement droppée (bug actuel : `performSave` retourne `false` si `savingRef.current`)
- Soit la seconde sauvegarde est mise en queue, soit elle est explicitement notifiée
- `pendingChanges` revient à 0 après les deux sauvegardes

**RÉGRESSION DOCUMENTÉE :** Dans le code actuel (`use-document-save.ts:105`), `if (!documentId || savingRef.current) return false;` drop silencieusement la seconde sauvegarde. Ce test DOIT échouer sur le code actuel.

**Validation :**
```typescript
const mockSaveDocument = vi.fn().mockResolvedValue({ stored_document_id: 'doc-1' });
// ... monter le hook, simuler concurrence
// Vérifier que mockSaveDocument a été appelé au moins 2 fois OU
// que le hook a mis en queue la seconde sauvegarde
```

**Fichier cible :** `apps/web/src/hooks/__tests__/use-document-save.test.tsx`

---

## 3. Tests à Implémenter

### 3.1 Tests Unitaires (packages/pdf-engine)

| Fichier | Priorité | Description | Dépend de |
|---|---|---|---|
| `__tests__/roundtrip/s1-helvetica-roundtrip.test.ts` | HAUTE | S1 ci-dessus | Fixtures existantes |
| `__tests__/roundtrip/s2-embedded-font-roundtrip.test.ts` | CRITIQUE | S2 ci-dessus | Fixture `embedded-fonts.pdf` |
| `__tests__/roundtrip/s6-large-pdf-roundtrip.test.ts` | HAUTE | S6 ci-dessus | Fixture générée programmatiquement |
| `__tests__/roundtrip/s9-annotations-roundtrip.test.ts` | HAUTE | S9 ci-dessus | Fixtures existantes |
| `__tests__/render/text-renderer-original-font.test.ts` | CRITIQUE | Vérifier que `originalFont` dans `TextStyle` est propagé à travers `addText`/`updateText` | Fixture `embedded-fonts.pdf` |
| `__tests__/engine/save-garbage-gc.test.ts` | CRITIQUE | `saveDocument(garbage=1..4)` doit préserver les polices embarquées vs garbage=0 | Fixture `embedded-fonts.pdf` |
| `__tests__/parse/font-extractor.test.ts` | CRITIQUE | Tests du futur `font-extractor.ts` (extraction, hashing, format détection) | À créer en Wave 2 |

### 3.2 Tests d'Intégration (Next.js API Routes)

| Fichier | Priorité | Description |
|---|---|---|
| `apps/web/src/app/api/pdf/__tests__/apply-elements.integration.test.ts` | CRITIQUE | POST avec text op sur PDF police custom → vérifier police préservée dans le retour |
| `apps/web/src/app/api/pdf/__tests__/save-garbage-level.integration.test.ts` | CRITIQUE | garbage=0 préserve fonts, garbage=2 peut supprimer fonts non-référencées |
| `apps/web/src/app/api/pdf/__tests__/open-response-shape.test.ts` | HAUTE | Snapshot contrat réponse + futur champ `fonts[]` |
| `apps/web/src/hooks/__tests__/use-document-save.test.tsx` | CRITIQUE | S10 — race condition debounce/immediate |

### 3.3 Tests d'Intégration Python (FastAPI)

| Fichier | Priorité | Description |
|---|---|---|
| `tests/integration/test_storage_roundtrip.py` | HAUTE | POST /api/v1/storage/documents → GET → vérifier bytes identiques (chiffrement round-trip) |
| `tests/integration/test_apply_elements_fonts.py` | CRITIQUE | Appel API Python côté apply-elements avec police non-standard, vérifier non-Helvetica dans réponse |

### 3.4 Tests E2E Playwright (à créer)

| Fichier | Priorité | Description |
|---|---|---|
| `tests/e2e/editor-text-edit.spec.ts` | HAUTE | Ouvrir éditeur, modifier texte, sauvegarder, recharger, vérifier texte présent |
| `tests/e2e/widget-font-loading.spec.ts` | CRITIQUE | Widget iframe : PDF avec police custom → vérifier rendu visuel via screenshot |
| `tests/e2e/editor-font-preservation.spec.ts` | CRITIQUE | Modifier texte Calibri → sauvegarder → recharger → vérifier police Calibri dans DOM canvas |

---

## 4. Fixtures PDF Nécessaires

| Fixture | Chemin | Priorité | Comment créer | Ce qu'elle teste |
|---|---|---|---|---|
| `embedded-fonts.pdf` | `packages/pdf-engine/__tests__/fixtures/` | CRITIQUE | Python + reportlab ou fpdf2 avec TTF Calibri ; ou télécharger un PDF public avec polices embarquées | S2, S2-ext, font-extractor |
| `large-100pages.pdf` | `packages/pdf-engine/__tests__/fixtures/` | HAUTE | Script `create-fixtures.ts` — boucle 100 pages avec pdf-lib | S6 |
| `with-images-compressed.pdf` | `packages/pdf-engine/__tests__/fixtures/` | MOYENNE | pdf-lib + sharp : intégrer une JPEG 100KB + compresser | S7 |
| `signed-padesbasic.pdf` | `packages/pdf-engine/__tests__/fixtures/` | MOYENNE | pyHanko CLI : `sign_pdf --field /Page[0]/sigField` avec clé test | S4 |
| `password-protected.pdf` | `packages/pdf-engine/__tests__/fixtures/` | MOYENNE | PyPDF2 + owner password "owner123" + user password "test123" | S5 |
| `with-ocg-layers.pdf` | `packages/pdf-engine/__tests__/fixtures/` | BASSE | pdf-lib OCG API ou Acrobat | S8 |

### Script de génération `large-100pages.pdf` (à ajouter dans `create-fixtures.ts`) :

```typescript
async function createLargeHundredPagesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 100; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i} — GigaPDF Large Document Test`, {
      x: 50, y: 700, size: 16, font, color: rgb(0, 0, 0)
    });
    page.drawText(`Content block page ${i}. This is the main body text.`, {
      x: 50, y: 650, size: 12, font
    });
  }
  return doc.save();
}
```

### Script de génération `embedded-fonts.pdf` (Python recommandé) :

```python
# scripts/create-embedded-fonts-fixture.py
from fpdf import FPDF
pdf = FPDF()
pdf.add_page()
pdf.add_font("Calibri", "", "/path/to/Calibri.ttf", uni=True)
pdf.set_font("Calibri", size=14)
pdf.cell(200, 10, txt="Texte en police Calibri embarquée", ln=True)
pdf.set_font("Helvetica", size=12)
pdf.cell(200, 10, txt="Texte en Helvetica standard", ln=True)
pdf.output("packages/pdf-engine/__tests__/fixtures/embedded-fonts.pdf")
```

**Alternative libre de droits :** Utiliser le PDF de démo de la bibliothèque pdfjs : [pdf.js/examples/learning/helloworld.pdf](https://github.com/mozilla/pdf.js/tree/master/examples) ou tout PDF public domaine contenant des polices non-standard.

---

## 5. Assertions de Fidélité

### 5.1 Assertions structurelles (programmatiques)

```typescript
// Utilitaire réutilisable dans roundtrip helpers
async function assertRoundTripFidelity(
  originalBytes: Buffer,
  savedBytes: Buffer,
  options: {
    checkFontNames?: string[];          // polices qui doivent survivre
    checkTextContent?: string[];        // textes qui doivent être présents
    maxSizeRatio?: number;              // max savedSize / originalSize (défaut 2.0)
    allowNewElements?: boolean;         // si false, strictement les mêmes éléments
  } = {}
) {
  // 1. Header PDF valide
  expect(savedBytes.slice(0, 5).toString('ascii')).toBe('%PDF-');

  // 2. Taille raisonnable
  const ratio = savedBytes.length / originalBytes.length;
  expect(ratio).toBeLessThan(options.maxSizeRatio ?? 2.0);

  // 3. Re-parse sans erreur
  const savedDoc = await parseDocument(savedBytes);
  expect(savedDoc.pages.length).toBeGreaterThan(0);

  // 4. Polices préservées (heuristique via originalFont ou fontFamily)
  if (options.checkFontNames?.length) {
    const allFonts = savedDoc.pages
      .flatMap(p => p.elements)
      .filter(e => e.type === 'text')
      .map(e => (e as TextElement).style);
    for (const fontName of options.checkFontNames) {
      expect(
        allFonts.some(s => 
          s.originalFont?.toLowerCase().includes(fontName.toLowerCase()) ||
          s.fontFamily?.toLowerCase().includes(fontName.toLowerCase())
        )
      ).toBe(true);
    }
  }

  // 5. Textes présents
  if (options.checkTextContent?.length) {
    const allTexts = savedDoc.pages
      .flatMap(p => p.elements)
      .filter(e => e.type === 'text')
      .map(e => (e as TextElement).content ?? '');
    for (const text of options.checkTextContent) {
      expect(allTexts.some(t => t.includes(text))).toBe(true);
    }
  }
}
```

### 5.2 Validation via pdfinfo (CLI — tests E2E ou scripts de validation)

```bash
# Vérifier que les polices sont listées dans le PDF sauvegardé
pdfinfo saved.pdf | grep -E "^(Fonts|Encrypted|Form)"

# Vérifier les polices embarquées (liste détaillée)
pdffonts saved.pdf

# Output attendu pour un PDF avec Calibri embarqué :
# name                        type    emb sub uni object ID
# Calibri                     TrueType  yes yes yes  12  0
# Helvetica                   Type1     no  no  yes   8  0
```

### 5.3 Régression visuelle (Playwright — tests E2E)

```typescript
// tests/e2e/visual-regression.spec.ts
test('PDF render visually identical after text edit', async ({ page }) => {
  await page.goto('/editor/test-document-id');
  
  // Screenshot avant édition
  const before = await page.locator('[data-testid="pdf-canvas"]').screenshot();
  
  // Éditer un texte sur la page
  await page.click('[data-testid="text-tool"]');
  await page.click('[data-testid="canvas-overlay"]', { position: { x: 200, y: 300 } });
  await page.keyboard.type('Nouveau texte');
  
  // Sauvegarder et recharger
  await page.click('[data-testid="save-button"]');
  await page.waitForSelector('[data-testid="save-success"]');
  await page.reload();
  
  // Screenshot après reload
  const after = await page.locator('[data-testid="pdf-canvas"]').screenshot();
  
  // Les pages non-éditées doivent être visuellement identiques (±2% de diff)
  // Utiliser @playwright/test compareScreenshots
  expect(after).toMatchSnapshot('after-text-edit-reload.png', { maxDiffPixelRatio: 0.02 });
});
```

### 5.4 Hashes de stabilité (pour les fixtures sans édition)

```typescript
// Vérifier que save → re-open → save produit un hash stable
// (save idempotent — important pour éviter les corruptions invisibles)
test('saveDocument is idempotent for unmodified documents', async () => {
  const handle1 = await openDocument(originalBuffer);
  const saved1 = await saveDocument(handle1);
  
  const handle2 = await openDocument(saved1);
  const saved2 = await saveDocument(handle2);
  
  // Les bytes peuvent différer (timestamps, compression) mais doivent produire
  // le même contenu fonctionnel
  const doc1 = await parseDocument(saved1);
  const doc2 = await parseDocument(saved2);
  
  expect(doc2.metadata.pageCount).toBe(doc1.metadata.pageCount);
  expect(doc2.pages[0].elements).toHaveLength(doc1.pages[0].elements.length);
});
```

---

## 6. Intégration CI/CD

### 6.1 Configuration Vitest (existante — à compléter)

```typescript
// packages/pdf-engine/vitest.config.ts — ajouter les répertoires roundtrip
export default defineConfig({
  test: {
    include: [
      '__tests__/**/*.test.ts',
      '__tests__/roundtrip/**/*.test.ts', // nouveau
    ],
    coverage: {
      include: ['src/**'],
      thresholds: {
        global: { lines: 80, branches: 75, functions: 80 },
        // Seuils spécifiques pour les fichiers critiques
        'src/render/text-renderer.ts': { lines: 95 },
        'src/engine/document-handle.ts': { lines: 90 },
      },
    },
    testTimeout: 30000, // Les tests round-trip avec gros PDF peuvent prendre du temps
  },
});
```

### 6.2 Configuration Pytest (à créer)

```ini
# pytest.ini (racine /app)
[pytest]
testpaths = tests
asyncio_mode = auto
filterwarnings = ignore::DeprecationWarning
markers =
    roundtrip: Tests de fidélité round-trip PDF
    regression: Tests de non-régression (doivent passer sur main)
    failing_pre_wave2: Tests qui échouent intentionnellement avant Wave 2 fonts

# Pour lancer uniquement les tests round-trip :
# pytest -m roundtrip
# Pour exclure les tests attendus comme failing :
# pytest -m "not failing_pre_wave2"
```

### 6.3 GitHub Actions — nouveau job `roundtrip-tests`

```yaml
# .github/workflows/ci.yml — ajouter après le job `test`

roundtrip-tests:
  runs-on: ubuntu-latest
  needs: test
  steps:
    - uses: actions/checkout@v4
    - name: Setup Node.js 22
      uses: actions/setup-node@v4
      with:
        node-version: '22'
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Generate large PDF fixture
      run: npx tsx packages/pdf-engine/__tests__/fixtures/create-fixtures.ts
    - name: Run round-trip tests
      run: pnpm --filter @giga-pdf/pdf-engine test --reporter=verbose --run
      env:
        VITEST_INCLUDE: '__tests__/roundtrip/**'
    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: roundtrip-test-results
        path: packages/pdf-engine/coverage/

# Gate bloquant pour la Wave 2 fonts :
wave2-font-gate:
  runs-on: ubuntu-latest
  needs: roundtrip-tests
  steps:
    - name: Verify S2 font preservation test passes
      run: |
        pnpm --filter @giga-pdf/pdf-engine test --reporter=verbose --run \
          --testNamePattern="S2|embedded-font|font preservation"
```

### 6.4 Commandes de lancement

```bash
# Lancer tous les tests round-trip (PDF engine)
pnpm --filter @giga-pdf/pdf-engine test --run __tests__/roundtrip/

# Lancer uniquement les tests CRITIQUE (avant merge Wave 2)
pnpm --filter @giga-pdf/pdf-engine test --run \
  __tests__/roundtrip/s2-embedded-font-roundtrip.test.ts \
  __tests__/roundtrip/s1-helvetica-roundtrip.test.ts \
  __tests__/engine/save-garbage-gc.test.ts

# Lancer les tests d'intégration Next.js routes
pnpm --filter web test --run src/app/api/pdf/__tests__/

# Lancer les tests Python round-trip
pytest tests/integration/test_storage_roundtrip.py -v

# Lancer les tests E2E Playwright (nécessite l'app lancée)
pnpm --filter web test:e2e -- tests/e2e/editor-font-preservation.spec.ts
```

---

## 7. Priorisation — Tests Indispensables Avant Merge Wave 2 Fonts

### TIER 1 — Bloquants (0 merge sans eux)

| ID | Test | Fichier | Raison |
|---|---|---|---|
| RT-01 | saveDocument(garbage=0) préserve polices embarquées | `save-garbage-gc.test.ts` | La régression garbage=0 invalide le fix complet si elle persiste |
| RT-02 | addText/updateText propagent originalFont | `text-renderer-original-font.test.ts` | Régression active en prod — c'est le bug principal de Wave 2 |
| RT-03 | S2 — police custom survive au round-trip | `s2-embedded-font-roundtrip.test.ts` | Test de contrat de la Wave 2 : DOIT PASSER après merge |
| RT-04 | S10 — pas de data loss sous concurrence | `use-document-save.test.tsx` | Race condition en prod qui peut provoquer perte de données |

### TIER 2 — Fortement recommandés (risque acceptable sans eux, mais à implémenter dans les 48h post-merge)

| ID | Test | Fichier | Raison |
|---|---|---|---|
| RT-05 | S1 — round-trip Helvetica de base | `s1-helvetica-roundtrip.test.ts` | Régression basique, doit être vert en permanence |
| RT-06 | S3 — AcroForm survit au save | `s3-acroform-roundtrip.test.ts` | Les formulaires sont un use-case critique |
| RT-07 | S6 — 100 pages intégrité | `s6-large-pdf-roundtrip.test.ts` | Performance et intégrité gros documents |
| RT-08 | S9 — annotations persistées | `s9-annotations-roundtrip.test.ts` | Use-case annotations |
| RT-09 | apply-elements intégration | `apply-elements.integration.test.ts` | Test de bout en bout de la route critique |

### TIER 3 — Post-Wave 2 (3-7 jours)

| ID | Test | Raison |
|---|---|---|
| RT-10 | S4 — signature invalidée gracieusement | Documentation comportement, pas un bug |
| RT-11 | S5 — chiffrement préservé | Dépend du support déchiffrement |
| RT-12 | S7 — compression images | Éviter la régression qualité images |
| RT-13 | S8 — calques OCG | Feature peu utilisée |
| RT-14 | E2E Playwright visual regression | Infrastructure E2E à mettre en place |
| RT-15 | Python storage round-trip | Compléter la couverture backend |

### Critères de validation avant merge Wave 2

```
[ ] RT-01 VERT (garbage=0 préserve polices)
[ ] RT-02 VERT (originalFont propagé)
[ ] RT-03 VERT (S2 police custom round-trip)
[ ] RT-04 VERT (S10 no data loss)
[ ] Couverture packages/pdf-engine >= 80% (global)
[ ] Couverture src/render/text-renderer.ts >= 95%
[ ] Aucun test existant régressé (CI vert)
[ ] @regression-guard validé ✓
```

---

## Annexe A — Cartographie des Régressions Connues (Baseline pré-Wave 2)

| Régression | Localisation | Impact | Test correspondant |
|---|---|---|---|
| Fallback Helvetica silencieux | `font-map.ts:46` + `text-renderer.ts:32` | CRITIQUE — perte police en prod | RT-02, RT-03 |
| `garbage=0` non garanti | `save/route.ts:34` — le garbage est passé depuis le form | CRITIQUE — potentiel GC polices | RT-01 |
| `originalFont` jamais propagé | `apply-elements/route.ts` — champ ignoré | HAUT — police perdue au save | RT-02 |
| Race condition `saveWithPriority` | `use-document-save.ts:105` | CRITIQUE — perte données silencieuse | RT-04 |

Ces 4 régressions constituent la **baseline pré-Wave 2**. Les tests RT-01 à RT-04 doivent être **rouges sur `main` actuel** et **verts après merge Wave 2**.

---

## Annexe B — Dépendances entre Fixtures et Tests

```
embedded-fonts.pdf (à créer)
  └── RT-02 text-renderer-original-font.test.ts
  └── RT-03 s2-embedded-font-roundtrip.test.ts
  └── RT-01 save-garbage-gc.test.ts

large-100pages.pdf (à générer via create-fixtures.ts)
  └── RT-07 s6-large-pdf-roundtrip.test.ts

simple.pdf / with-forms.pdf (existants)
  └── RT-05 s1-helvetica-roundtrip.test.ts
  └── RT-06 s3-acroform-roundtrip.test.ts
  └── RT-08 s9-annotations-roundtrip.test.ts
  └── RT-04 use-document-save.test.tsx (mocks API, pas de fixture PDF)
```

**Priorité de création des fixtures :**
1. `embedded-fonts.pdf` — bloquant pour RT-01, RT-02, RT-03
2. `large-100pages.pdf` — ajout dans `create-fixtures.ts` (30 min de travail)
3. Autres fixtures — Wave 2 post-merge
