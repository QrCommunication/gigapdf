import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';

const buf = readFileSync('/tmp/gigapdf-debug/v1.pdf');
const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
const ctx = doc.context;

for (const [, obj] of ctx.enumerateIndirectObjects()) {
  if (!obj || typeof obj.get !== 'function') continue;
  const baseFont = obj.get(PDFName.of('BaseFont'));
  if (!baseFont || !String(baseFont).includes('OCRB')) continue;
  const descRef = obj.get(PDFName.of('FontDescriptor'));
  const desc = ctx.lookup(descRef);
  const fileRef = desc.get(PDFName.of('FontFile3'));
  const stream = ctx.lookup(fileRef);
  console.log('stream class:', stream.constructor.name);
  console.log('dict keys:', stream.dict ? [...stream.dict.entries().keys?.() ?? []] : 'no dict');
  
  const raw = stream.getContents();
  console.log('raw len:', raw.length, 'first bytes:', Buffer.from(raw.slice(0, 4)).toString('hex'));
  
  // Try decoding with pdf-lib helper
  try {
    const decoded = decodePDFRawStream(stream).decode();
    console.log('decoded len:', decoded.length, 'first bytes:', Buffer.from(decoded.slice(0, 4)).toString('hex'));
    writeFileSync('/tmp/gigapdf-debug/ocrb-decoded.bin', decoded);
  } catch (e) {
    console.log('decodePDFRawStream FAILED:', e.message);
    // Manual zlib
    try {
      const dec = inflateSync(Buffer.from(raw));
      console.log('manual inflate OK, len:', dec.length, 'first bytes:', dec.slice(0, 4).toString('hex'));
      writeFileSync('/tmp/gigapdf-debug/ocrb-decoded.bin', dec);
    } catch (e2) {
      console.log('manual inflate FAILED:', e2.message);
    }
  }
  break;
}
