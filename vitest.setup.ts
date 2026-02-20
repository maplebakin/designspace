import { vi } from 'vitest';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (!(globalThis as any).indexedDB) {
  (globalThis as any).indexedDB = {
    open: vi.fn(() => ({
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: {
        createObjectStore: vi.fn(),
        transaction: vi.fn(() => ({ objectStore: vi.fn(() => ({})) })),
      },
    })),
    deleteDatabase: vi.fn(),
  };
}
