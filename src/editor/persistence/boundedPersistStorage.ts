import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { quarantineLocalStorageValue } from './startupStorageRecovery';

type BoundedStorageOptions = {
  maxBytes: number;
};

export const createBoundedPersistStorage = <T>(
  options: BoundedStorageOptions
): PersistStorage<T> => ({
  getItem: (name): StorageValue<T> | null => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(name);
    if (raw === null) return null;
    if (raw.length * 2 > options.maxBytes) {
      quarantineLocalStorageValue(window.localStorage, name, raw, 'oversized');
      return null;
    }
    try {
      return JSON.parse(raw) as StorageValue<T>;
    } catch {
      quarantineLocalStorageValue(window.localStorage, name, raw, 'corrupt-json');
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;
    const raw = JSON.stringify(value);
    if (raw.length * 2 > options.maxBytes) {
      console.error(`Refusing to persist oversized state for ${name}.`);
      return;
    }
    if (window.localStorage.getItem(name) === raw) return;
    window.localStorage.setItem(name, raw);
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(name);
  },
});
