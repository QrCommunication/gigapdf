import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';

const buf = readFileSync('/tmp/gigapdf-debug/v1-edited.pdf');
const doc = await PDFDocument.load(new Uint8Array(buf));
const page = doc.getPage(0);
const node = page.node;
const ops = node.normalizedEntries();
console.log('Page resources fonts:', node.Resources()?.lookup('Font' )?.entries?.()?.length || '?');

// Get last content stream which should have the new bake
const ctx = doc.context;
const contents = node.normalizedEntries().Contents;
console.log('contents class:', contents?.constructor?.name);
