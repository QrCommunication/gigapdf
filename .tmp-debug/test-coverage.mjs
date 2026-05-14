import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';

const ttf = readFileSync('/tmp/gigapdf-debug/ocrb-via-converter.ttf');
const font = fontkit.create(ttf);
console.log('font:', font.fullName, 'numGlyphs:', font.numGlyphs);
for (const ch of 'LICHA 2') {
  const cp = ch.codePointAt(0);
  const g = font.glyphForCodePoint(cp);
  console.log(`  '${ch}' (U+${cp.toString(16)}) → glyph id=${g.id} (notdef=${g.id === 0})`);
}
