import { convertFontToTtf } from '../packages/pdf-engine/src/utils/convert-font-to-ttf.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const cffBytes = readFileSync('/tmp/gigapdf-debug/ocrb-decoded.bin');
const ttf = await convertFontToTtf(new Uint8Array(cffBytes), 'cff');
console.log('TTF length:', ttf.length, 'magic:', Buffer.from(ttf.slice(0, 4)).toString('hex'));
writeFileSync('/tmp/gigapdf-debug/ocrb-via-converter.ttf', ttf);
