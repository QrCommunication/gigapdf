export { mergePDFs, type MergeOptions } from './merge';
export { splitPDF, splitAt } from './split';
export type { PageRange } from '../utils/page-range';

export interface SplitOptions {
  nameTemplate?: string;
}
