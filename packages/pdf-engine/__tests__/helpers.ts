import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, 'fixtures');

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

export const SIMPLE_PDF = 'simple.pdf';
export const MULTI_PAGE_PDF = 'multi-page.pdf';
export const WITH_FORMS_PDF = 'with-forms.pdf';
export const LANDSCAPE_PDF = 'landscape.pdf';
