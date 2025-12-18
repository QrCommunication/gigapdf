/**
 * Common types used across the application.
 * All coordinates use web-standard system (origin top-left, Y increases downward).
 * Values are in PDF points (1 point = 1/72 inch).
 */

export type UUID = string;

export type ISODateTime = string;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface Transform {
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

export interface Pagination {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
