import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);

const bytes = readFileSync('/tmp/gigapdf-debug/ocrb-converted.ttf');
const f = await doc.embedFont(bytes, { subset: false });
console.log('TTF embed OK, name:', f.name);
console.log('  height:', f.heightAtSize(10));
console.log('  width "LICHA 2" @10pt:', f.widthOfTextAtSize('LICHA 2', 10));
