import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);

const bytes = readFileSync('/tmp/gigapdf-debug/font-0-_HXBDOG_OCRB10PitchBT_Regular.cff.bin');
try {
  const f = await doc.embedFont(bytes, { subset: false });
  console.log('CFF embed OK', f.name);
} catch (e) {
  console.log('CFF embed FAILED:', e.message);
}

// Try wrapping in fontkit's openType wrapper... actually fontkit needs a complete OTF/TTF
