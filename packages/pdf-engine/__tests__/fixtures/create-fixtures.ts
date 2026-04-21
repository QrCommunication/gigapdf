/**
 * Generate test PDF fixtures using pdf-lib.
 * Run: npx tsx __tests__/fixtures/create-fixtures.ts
 *
 * Fixtures générées :
 *  - simple.pdf               : 1 page, Helvetica standard
 *  - multi-page.pdf           : 5 pages, Helvetica
 *  - with-forms.pdf           : AcroForm avec 4 champs
 *  - encrypted-placeholder.pdf: Simule un PDF chiffré (non chiffré réellement)
 *  - landscape.pdf            : 1 page paysage
 *  - embedded-fonts.pdf       : PDF avec polices TTF embarquées (DejaVu + Helvetica)
 *  - large-100pages.pdf       : 100 pages, Helvetica (test intégrité gros documents)
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname ?? __dirname, '.');

async function createSimplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Hello GigaPDF Test', { x: 50, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('Second line of text', { x: 50, y: 660, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawRectangle({ x: 50, y: 500, width: 200, height: 100, color: rgb(0.9, 0.1, 0.1), opacity: 0.5 });
  page.drawLine({ start: { x: 50, y: 480 }, end: { x: 300, y: 480 }, color: rgb(0, 0, 1), thickness: 2 });
  page.drawEllipse({ x: 400, y: 550, xScale: 60, yScale: 40, color: rgb(0, 0.8, 0) });
  return doc.save();
}

async function createMultiPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 5; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i}`, { x: 50, y: 700, size: 24, font });
    page.drawText(`Content for page ${i}`, { x: 50, y: 660, size: 14, font });
  }
  return doc.save();
}

async function createWithFormsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Form Document', { x: 50, y: 700, size: 20, font });

  const form = doc.getForm();
  const nameField = form.createTextField('name');
  nameField.setText('John Doe');
  nameField.addToPage(page, { x: 50, y: 600, width: 200, height: 30 });

  const emailField = form.createTextField('email');
  emailField.addToPage(page, { x: 50, y: 550, width: 200, height: 30 });

  const checkbox = form.createCheckBox('agree');
  checkbox.addToPage(page, { x: 50, y: 500, width: 20, height: 20 });

  const dropdown = form.createDropdown('country');
  dropdown.addOptions(['France', 'USA', 'UK', 'Germany']);
  dropdown.select('France');
  dropdown.addToPage(page, { x: 50, y: 450, width: 200, height: 30 });

  return doc.save();
}

async function createEncryptedPdf(): Promise<Uint8Array> {
  // pdf-lib can't natively encrypt, so we create a normal PDF
  // and mark it as "encrypted fixture" for testing decrypt path
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('This would be encrypted', { x: 50, y: 700, size: 20, font });
  return doc.save();
}

async function createLandscapePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([792, 612]); // landscape
  page.drawText('Landscape Document', { x: 50, y: 550, size: 24, font });
  return doc.save();
}

/**
 * Crée un PDF avec une police TTF embarquée (DejaVu Sans si disponible sur le système,
 * sinon génère un PDF avec uniquement des polices standard pour garantir
 * la reproductibilité de la fixture).
 *
 * La fixture contient :
 *  - Un texte avec une police TTF embarquée (DejaVu Sans ou simulation)
 *  - Un texte avec Helvetica standard (référence)
 *
 * IMPORTANT : pdf-lib ne peut pas embarquer des polices CID/TTF réelles sans les bytes
 * du fichier TTF. On utilise donc une technique qui produit une police de sous-ensemble
 * réel en chargeant un fichier TTF disponible sur le système ou en bundle.
 */
async function createEmbeddedFontsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Enregistrer fontkit pour permettre l'embarquement de polices TTF/OTF custom
  doc.registerFontkit(fontkit);

  // Chercher un fichier TTF disponible dans des emplacements courants (Linux + macOS + Node modules)
  const candidatePaths = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
    // Zorin OS / Ubuntu variants
    '/usr/share/fonts/truetype/selawik-zorin-os/selawk.ttf',
    '/usr/share/fonts/truetype/tiresias/tiresias_pcfont.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    // macOS
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
  ];

  let customFont = null;
  let customFontName = 'DejaVuSans';

  for (const fontPath of candidatePaths) {
    if (existsSync(fontPath)) {
      try {
        const fontBytes = readFileSync(fontPath);
        customFont = await doc.embedFont(fontBytes, { subset: true });
        // Extraire le nom de la police du chemin
        const base = fontPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'CustomFont';
        customFontName = base;
        console.log(`  Using TTF font: ${fontPath}`);
        break;
      } catch {
        // Ce fichier TTF n'est pas utilisable, essayer le suivant
        continue;
      }
    }
  }

  // Police standard toujours disponible (référence)
  const helveticaFont = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([612, 792]);

  if (customFont) {
    // Texte avec police embarquée réelle
    page.drawText('Custom embedded font — DejaVu/Liberation/Ubuntu', {
      font: customFont,
      x: 50,
      y: 700,
      size: 18,
      color: rgb(0, 0, 0),
    });

    page.drawText(`Font: ${customFontName} (TTF subset embarqué)`, {
      font: customFont,
      x: 50,
      y: 670,
      size: 12,
      color: rgb(0.2, 0.2, 0.8),
    });

    page.drawText('Calibri simulation — police custom round-trip test', {
      font: customFont,
      x: 50,
      y: 640,
      size: 14,
      color: rgb(0.1, 0.5, 0.1),
    });
  } else {
    // Fallback : simuler la présence d'une police "custom" via Courier
    // (pdf-lib peut l'embarquer comme Type1 non-standard)
    const courierFont = await doc.embedFont(StandardFonts.Courier);
    page.drawText('Custom font simulation (Courier as embedded fallback)', {
      font: courierFont,
      x: 50,
      y: 700,
      size: 18,
      color: rgb(0, 0, 0),
    });
    console.log('  Warning: No TTF found on system, using Courier as embedded font fallback');
  }

  // Texte de référence avec Helvetica standard
  page.drawText('Helvetica standard — référence non-embedded', {
    font: helveticaFont,
    x: 50,
    y: 600,
    size: 12,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawText('Round-trip test fixture v1.0 — embedded-fonts.pdf', {
    font: helveticaFont,
    x: 50,
    y: 50,
    size: 8,
    color: rgb(0.7, 0.7, 0.7),
  });

  return doc.save();
}

/**
 * Crée un PDF de 100 pages pour tester l'intégrité des gros documents.
 * Chaque page contient un texte "Page N" et un bloc de contenu.
 */
async function createLargeHundredPagesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= 100; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i} — GigaPDF Large Document Test`, {
      x: 50,
      y: 700,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`Content block page ${i}. This is the main body text for testing integrity.`, {
      x: 50,
      y: 660,
      size: 12,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`Section A — paragraph 1 for page ${i}`, {
      x: 50,
      y: 630,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  return doc.save();
}

async function main() {
  mkdirSync(DIR, { recursive: true });

  const fixtures: Array<{ name: string; gen: () => Promise<Uint8Array> }> = [
    { name: 'simple.pdf', gen: createSimplePdf },
    { name: 'multi-page.pdf', gen: createMultiPagePdf },
    { name: 'with-forms.pdf', gen: createWithFormsPdf },
    { name: 'encrypted-placeholder.pdf', gen: createEncryptedPdf },
    { name: 'landscape.pdf', gen: createLandscapePdf },
    { name: 'embedded-fonts.pdf', gen: createEmbeddedFontsPdf },
    { name: 'large-100pages.pdf', gen: createLargeHundredPagesPdf },
  ];

  for (const { name, gen } of fixtures) {
    console.log(`Generating ${name}...`);
    const bytes = await gen();
    writeFileSync(join(DIR, name), bytes);
    console.log(`  Created ${name} (${bytes.length} bytes)`);
  }
}

main().catch(console.error);
