import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const req = createRequire(`${process.cwd()}/package.json`);
const pdfjsLib = await import(req.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

const buf = readFileSync('/tmp/gigapdf-debug/v1-edited.pdf');
const data = new Uint8Array(buf);
const doc = await pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
const page = await doc.getPage(1);
const tc = await page.getTextContent();
for (const item of tc.items) {
  if (!item.str) continue;
  if (item.str.includes('LICHA') || item.str.trim() === '2' || item.str.includes(' 2')) {
    const t = item.transform;
    console.log(`'${item.str}'`, 'pos:', t[4], t[5], 'width:', item.width);
  }
}
