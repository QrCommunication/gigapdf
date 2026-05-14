import { PDFDocument, PDFName } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

const buf = readFileSync('/tmp/gigapdf-debug/v1.pdf');
const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
const ctx = doc.context;

let count = 0;
for (const [, obj] of ctx.enumerateIndirectObjects()) {
  if (!obj || typeof obj.get !== 'function') continue;
  const type = obj.get(PDFName.of('Type'));
  if (!type || String(type) !== '/Font') continue;
  const baseFont = obj.get(PDFName.of('BaseFont'));
  const subtype = obj.get(PDFName.of('Subtype'));
  console.log('Font:', String(baseFont), 'Subtype:', String(subtype));

  // Walk to FontDescriptor
  const descRef = obj.get(PDFName.of('FontDescriptor'));
  if (descRef) {
    const desc = ctx.lookup(descRef);
    if (desc && typeof desc.get === 'function') {
      const ff = desc.get(PDFName.of('FontFile'));
      const ff2 = desc.get(PDFName.of('FontFile2'));
      const ff3 = desc.get(PDFName.of('FontFile3'));
      console.log('  FontFile:', !!ff, 'FontFile2:', !!ff2, 'FontFile3:', !!ff3);

      const fileRef = ff ?? ff2 ?? ff3;
      if (fileRef) {
        const stream = ctx.lookup(fileRef);
        if (stream && typeof stream.getContents === 'function') {
          const bytes = stream.getContents();
          const tag = ff ? 'type1' : ff2 ? 'truetype' : 'cff';
          const path = `/tmp/gigapdf-debug/font-${count}-${String(baseFont).replace(/[^a-zA-Z0-9]/g, '_')}.${tag}.bin`;
          writeFileSync(path, bytes);
          console.log('  → Wrote', bytes.length, 'bytes to', path);
          count++;
        }
      }
    }
  }
}
