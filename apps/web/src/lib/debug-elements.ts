"use client";

/**
 * Debug utility — exposes parsed elements in dev console.
 * Attach via: window.__debugElements = elementsArray
 * Then in console: console.table(window.__debugElements.filter(e => e.type === 'text').map(e => ({content: e.content, x: e.bounds.x, y: e.bounds.y, w: e.bounds.width, h: e.bounds.height, size: e.style.fontSize})))
 */
declare global {
  interface Window {
    __debugElements?: unknown[];
    __debugCanvas?: unknown;
  }
}

export {};
