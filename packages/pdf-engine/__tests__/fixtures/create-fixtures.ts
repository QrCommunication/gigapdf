/**
 * Generate test PDF fixtures using pdf-lib.
 * Run: npx tsx __tests__/fixtures/create-fixtures.ts
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
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

async function main() {
  mkdirSync(DIR, { recursive: true });

  const fixtures = [
    { name: 'simple.pdf', gen: createSimplePdf },
    { name: 'multi-page.pdf', gen: createMultiPagePdf },
    { name: 'with-forms.pdf', gen: createWithFormsPdf },
    { name: 'encrypted-placeholder.pdf', gen: createEncryptedPdf },
    { name: 'landscape.pdf', gen: createLandscapePdf },
  ];

  for (const { name, gen } of fixtures) {
    const bytes = await gen();
    writeFileSync(join(DIR, name), bytes);
    console.log(`Created ${name} (${bytes.length} bytes)`);
  }
}

main().catch(console.error);
