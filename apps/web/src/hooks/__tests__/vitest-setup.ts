/**
 * Setup global pour les tests Vitest du web app.
 * Configuré dans vitest.config.ts → test.setupFiles.
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @giga-pdf/logger
// Évite d'avoir besoin du build du package dans les tests unitaires.
// ---------------------------------------------------------------------------
vi.mock('@giga-pdf/logger', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    setContext: vi.fn(),
    addTransport: vi.fn(),
  };
  return {
    Logger: vi.fn(() => mockLogger),
    useLogger: vi.fn(() => mockLogger),
    createDefaultLogger: vi.fn(() => mockLogger),
  };
});

// ---------------------------------------------------------------------------
// Mock @/lib/offline-queue (singleton)
// Évite les appels IndexedDB dans jsdom.
// ---------------------------------------------------------------------------
vi.mock('@/lib/offline-queue', () => {
  const mockQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    dequeue: vi.fn().mockResolvedValue(null),
    peek: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
    size: vi.fn().mockResolvedValue(0),
    flush: vi.fn().mockResolvedValue(0),
  };
  return {
    OfflineQueue: vi.fn(() => mockQueue),
    offlineQueue: mockQueue,
  };
});
