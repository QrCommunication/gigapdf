/**
 * Generate test PDF fixtures with the native `@qrcommunication/gigapdf-lib`
 * engine — zero third-party libraries (no pdf-lib, no fontkit, no sharp; raster
 * test images are encoded by the engine itself).
 * Run: pnpm fixtures:generate
 *
 * Fixtures:
 *  - simple-text.pdf      : 1 page, simple Latin text (standard Helvetica)
 *  - multi-page.pdf       : 5 numbered pages
 *  - with-forms.pdf       : AcroForm — text, checkbox, radio, dropdown
 *  - with-annotations.pdf : highlight, link, sticky note
 *  - with-images.pdf      : 1 JPEG + 1 PNG embedded (encoded by the engine)
 *  - rotated-pages.pdf    : pages at 0°, 90°, 180°, 270°
 *  - encrypted.pdf        : REAL AES-256 encrypted PDF (the engine encrypts natively)
 *  - cjk-text.pdf         : Japanese/Chinese text in UTF-16 metadata
 *  - rtl-text.pdf         : Arabic/Hebrew RTL text in UTF-16 metadata
 *  - mixed-fonts.pdf      : Helvetica / Times / Courier (6 standard fonts)
 *  - simple.pdf           : legacy alias of simple-text.pdf + shapes
 *  - landscape.pdf        : 1 landscape page
 *  - embedded-fonts.pdf   : a system TTF embedded (subset) if available
 *  - large-100pages.pdf   : 100 pages (integrity test)
 */
import type { GigaPdfEngine, GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { join } from 'node:path';
import { getEngine } from '../../src/wasm';

const DIR = join(import.meta.dirname ?? __dirname, '.');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A document with a single blank page of `w`×`h` points (no seed text). */
function blankDoc(giga: GigaPdfEngine, w = 612, h = 792): GigaPdfDoc {
  const doc = giga.open(giga.txtToPdf(' '));
  doc.addPage(w, h, 0); // prepend a blank page → page 1 blank, page 2 = seed
  doc.deletePage(2); // drop the seed page
  return doc;
}

/** A solid `w`×`h` RGBA8888 buffer of one colour. */
function solidRgba(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A 10×10 solid-colour JPEG via the native engine encoder. */
function redJpegBytes(giga: GigaPdfEngine): Uint8Array {
  return giga.encodeJpeg(solidRgba(10, 10, 255, 0, 0), 10, 10, 80);
}

/** A 10×10 solid-colour PNG via the native engine encoder. */
function bluePngBytes(giga: GigaPdfEngine): Uint8Array {
  return giga.rgbaToPng(solidRgba(10, 10, 0, 0, 255), 10, 10);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function createSimpleTextPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Simple Text Fixture');
  doc.setMetadata('Author', 'GigaPDF Test Suite');
  doc.addStandardText(1, 50, 720, 24, 'Hello GigaPDF — Simple Latin Text', 'Helvetica', 0x000000);
  doc.addStandardText(1, 50, 680, 14, 'The quick brown fox jumps over the lazy dog.', 'Helvetica', 0x333333);
  doc.addStandardText(1, 50, 650, 12, 'Pack my box with five dozen liquor jugs.', 'Helvetica', 0x4d4d4d);
  doc.addStandardText(1, 50, 620, 10, '0123456789 !@#$%^&*()_+-=[]{}|;:,./<>?', 'Helvetica', 0x666666);
  doc.addStandardText(1, 50, 50, 8, 'Fixture: simple-text.pdf', 'Helvetica', 0xb3b3b3);
  const out = doc.save();
  doc.close();
  return out;
}

function createMultiPagePdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Multi-Page Fixture');
  for (let i = 2; i <= 5; i++) doc.addPage(612, 792, i - 1);
  for (let i = 1; i <= 5; i++) {
    doc.addStandardText(i, 50, 720, 24, `Page ${i} of 5`, 'Helvetica', 0x000000);
    doc.addStandardText(i, 50, 680, 14, `Main content for page ${i}.`, 'Helvetica', 0x333333);
    doc.addStandardText(i, 50, 650, 11, `Section A — Body paragraph for page ${i}.`, 'Helvetica', 0x4d4d4d);
    doc.addStandardText(i, 300, 30, 10, `${i}`, 'Helvetica', 0x808080);
  }
  const out = doc.save();
  doc.close();
  return out;
}

function createWithFormsPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Forms Fixture');
  doc.addStandardText(1, 50, 720, 20, 'AcroForm Test Document', 'Helvetica', 0x000000);

  doc.addStandardText(1, 50, 660, 12, 'Name:', 'Helvetica');
  doc.addTextField(1, 'name', [120, 650, 320, 675], 'John Doe');
  doc.addStandardText(1, 50, 615, 12, 'Email:', 'Helvetica');
  doc.addTextField(1, 'email', [120, 605, 320, 630], '');
  doc.addStandardText(1, 50, 570, 12, 'Agree:', 'Helvetica');
  doc.addCheckbox(1, 'agree', [120, 563, 136, 579], true);
  doc.addStandardText(1, 50, 530, 12, 'Gender:', 'Helvetica');
  doc.addRadioGroup(
    1,
    'gender',
    [
      { export: 'male', rect: [120, 525, 134, 539] },
      { export: 'female', rect: [160, 525, 174, 539] },
    ],
    { selected: 'male' },
  );
  doc.addStandardText(1, 50, 490, 12, 'Country:', 'Helvetica');
  doc.addComboBox(1, 'country', ['France', 'USA', 'UK', 'Germany', 'Japan'], { selected: 'France' });
  // addComboBox places at a default rect; position the label only.
  const out = doc.save();
  doc.close();
  return out;
}

function createWithAnnotationsPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Annotations Fixture');
  doc.addStandardText(1, 50, 720, 20, 'Annotations Test Document', 'Helvetica');
  doc.addStandardText(1, 50, 660, 14, 'This text has a highlight annotation.', 'Helvetica');
  doc.addStandardText(1, 50, 610, 14, 'Click here to follow a link.', 'Helvetica', 0x0000cc);
  doc.addStandardText(1, 50, 560, 14, 'This paragraph has a sticky note.', 'Helvetica');

  doc.addHighlight(1, 50, 655, 400, 675, 0xffff00);
  doc.addUriLink(1, 50, 600, 230, 625, 'https://giga-pdf.com');
  doc.addTextNote(1, [370, 550, 390, 570], 0xffcc00, { contents: 'This is a sticky note comment.' });
  const out = doc.save();
  doc.close();
  return out;
}

async function createWithImagesPdf(giga: GigaPdfEngine): Promise<Uint8Array> {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Images Fixture');
  doc.addStandardText(1, 50, 720, 20, 'Images Fixture', 'Helvetica');
  doc.addStandardText(1, 50, 680, 12, 'JPEG image (10x10 red):', 'Helvetica');
  doc.addStandardText(1, 50, 540, 12, 'PNG image (10x10 blue):', 'Helvetica');
  doc.addImage(1, redJpegBytes(giga), 50, 580, 120, 80);
  doc.addImage(1, bluePngBytes(giga), 50, 430, 120, 80);
  doc.addStandardText(1, 50, 50, 8, 'Fixture: with-images.pdf', 'Helvetica', 0xb3b3b3);
  const out = doc.save();
  doc.close();
  return out;
}

function createRotatedPagesPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Rotated Pages Fixture');
  for (let i = 2; i <= 4; i++) doc.addPage(612, 792, i - 1);
  const rotations = [0, 90, 180, 270];
  for (let i = 0; i < 4; i++) {
    const page = i + 1;
    doc.addStandardText(page, 50, 720, 20, `Rotation: ${rotations[i]}deg`, 'Helvetica', 0x000000);
    doc.addStandardText(page, 50, 680, 12, `This page has a ${rotations[i]}deg /Rotate entry.`, 'Helvetica');
    if (rotations[i] !== 0) doc.rotatePage(page, rotations[i]!);
  }
  const out = doc.save();
  doc.close();
  return out;
}

function createEncryptedPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Encrypted PDF Fixture');
  doc.addStandardText(1, 50, 720, 20, 'Encrypted PDF (AES-256)', 'Helvetica');
  doc.addStandardText(1, 50, 680, 12, 'User password: user123 / Owner password: owner456', 'Helvetica', 0x801919);
  const keySeed = new Uint8Array(32);
  webcrypto.getRandomValues(keySeed);
  const out = doc.saveEncrypted('user123', 'gigapdf-fixture!', {
    ownerPassword: 'owner456',
    algorithm: 'aes256',
    keySeed,
  });
  doc.close();
  return out;
}

function createCjkTextPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'GigaPDF テスト — 日本語テキスト');
  doc.setMetadata('Subject', '中文测试文档 — PDF解析器测试');
  doc.setMetadata('Author', 'テスト作者');
  doc.addStandardText(1, 50, 720, 20, 'CJK Text Fixture', 'Helvetica');
  doc.addStandardText(1, 50, 680, 12, 'Metadata carries UTF-16 encoded CJK text.', 'Helvetica');
  doc.addStandardText(1, 50, 50, 8, 'Fixture: cjk-text.pdf', 'Helvetica', 0xb3b3b3);
  const out = doc.save();
  doc.close();
  return out;
}

function createRtlTextPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'مرحباً بك في GigaPDF — اختبار النص العربي');
  doc.setMetadata('Subject', 'שלום GigaPDF — בדיקת טקסט עברי');
  doc.setMetadata('Author', 'مختبر النظام');
  doc.addStandardText(1, 50, 720, 20, 'RTL Text Fixture (Arabic & Hebrew)', 'Helvetica');
  doc.addStandardText(1, 50, 680, 12, 'Metadata carries UTF-16 encoded RTL text.', 'Helvetica');
  doc.addStandardText(1, 50, 50, 8, 'Fixture: rtl-text.pdf', 'Helvetica', 0xb3b3b3);
  const out = doc.save();
  doc.close();
  return out;
}

function createMixedFontsPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.setMetadata('Title', 'Mixed Fonts Fixture');
  doc.addStandardText(1, 50, 720, 20, 'Mixed Fonts Fixture', 'Helvetica-Bold', 0x000000);
  doc.addStandardText(1, 50, 670, 14, 'Helvetica (regular) — Sans-serif', 'Helvetica', 0x1a1a1a);
  doc.addStandardText(1, 50, 645, 14, 'Helvetica Bold — Sans-serif bold', 'Helvetica-Bold', 0x1a1a1a);
  doc.addStandardText(1, 50, 610, 14, 'Times Roman — Serif', 'Times-Roman', 0x1a3380);
  doc.addStandardText(1, 50, 585, 14, 'Times Italic — Serif italic', 'Times-Italic', 0x1a3380);
  doc.addStandardText(1, 50, 550, 14, 'Courier — Monospace', 'Courier', 0x1a801a);
  doc.addStandardText(1, 50, 525, 14, 'Courier Bold — Monospace bold', 'Courier-Bold', 0x1a801a);
  doc.addStandardText(1, 50, 430, 10, 'Parser must detect 6 distinct fonts.', 'Helvetica', 0x666666);
  const out = doc.save();
  doc.close();
  return out;
}

function createSimplePdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  doc.addStandardText(1, 50, 700, 24, 'Hello GigaPDF Test', 'Helvetica', 0x000000);
  doc.addStandardText(1, 50, 660, 14, 'Second line of text', 'Helvetica', 0x333333);
  doc.addStandardText(1, 50, 620, 12, 'Monospace reference line', 'Courier', 0x4d4d4d);
  doc.addRectangle(1, 50, 500, 200, 100, null, 0xe61919);
  doc.drawLine(1, 50, 480, 300, 480, 0x0000ff, 2);
  doc.addEllipse(1, 400, 550, 60, 40, null, 0x00cc00);
  const out = doc.save();
  doc.close();
  return out;
}

function createLandscapePdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga, 792, 612);
  doc.addStandardText(1, 50, 550, 24, 'Landscape Document', 'Helvetica');
  const out = doc.save();
  doc.close();
  return out;
}

function createEmbeddedFontsPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  const candidatePaths = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  ];
  let embedded = false;
  for (const fontPath of candidatePaths) {
    if (existsSync(fontPath)) {
      const fontObj = doc.embedFont('Embedded', new Uint8Array(readFileSync(fontPath)));
      if (fontObj > 0) {
        doc.addText(1, 50, 700, 18, 'Custom embedded TrueType font', fontObj, 0x000000);
        doc.addText(1, 50, 670, 12, 'Round-trip test — TTF subset embedded', fontObj, 0x3333cc);
        embedded = true;
        // eslint-disable-next-line no-console
        console.log(`  Embedded TTF: ${fontPath}`);
        break;
      }
    }
  }
  if (!embedded) {
    doc.addStandardText(1, 50, 700, 18, 'No system TTF found — Courier fallback', 'Courier', 0x000000);
  }
  doc.addStandardText(1, 50, 600, 12, 'Helvetica standard — non-embedded reference', 'Helvetica', 0x808080);
  const out = doc.save();
  doc.close();
  return out;
}

function createLargeHundredPagesPdf(giga: GigaPdfEngine): Uint8Array {
  const doc = blankDoc(giga);
  for (let i = 2; i <= 100; i++) doc.addPage(612, 792, i - 1);
  for (let i = 1; i <= 100; i++) {
    doc.addStandardText(i, 50, 700, 16, `Page ${i} — GigaPDF Large Document Test`, 'Helvetica', 0x000000);
    doc.addStandardText(i, 50, 660, 12, `Content block page ${i}. Integrity test body.`, 'Helvetica', 0x333333);
  }
  const out = doc.save();
  doc.close();
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function generateAllFixtures(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const giga = await getEngine();

  const sync: Array<{ name: string; gen: (g: GigaPdfEngine) => Uint8Array }> = [
    { name: 'simple-text.pdf', gen: createSimpleTextPdf },
    { name: 'multi-page.pdf', gen: createMultiPagePdf },
    { name: 'with-forms.pdf', gen: createWithFormsPdf },
    { name: 'with-annotations.pdf', gen: createWithAnnotationsPdf },
    { name: 'rotated-pages.pdf', gen: createRotatedPagesPdf },
    { name: 'encrypted.pdf', gen: createEncryptedPdf },
    { name: 'cjk-text.pdf', gen: createCjkTextPdf },
    { name: 'rtl-text.pdf', gen: createRtlTextPdf },
    { name: 'mixed-fonts.pdf', gen: createMixedFontsPdf },
    { name: 'simple.pdf', gen: createSimplePdf },
    { name: 'landscape.pdf', gen: createLandscapePdf },
    { name: 'embedded-fonts.pdf', gen: createEmbeddedFontsPdf },
    { name: 'large-100pages.pdf', gen: createLargeHundredPagesPdf },
  ];

  for (const { name, gen } of sync) {
    writeFileSync(join(DIR, name), gen(giga));
    // eslint-disable-next-line no-console
    console.log(`✓ ${name}`);
  }
  writeFileSync(join(DIR, 'with-images.pdf'), await createWithImagesPdf(giga));
  // eslint-disable-next-line no-console
  console.log('✓ with-images.pdf');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void generateAllFixtures();
}
