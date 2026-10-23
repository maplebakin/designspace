import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createBoundedPersistStorage } from '../persistence/boundedPersistStorage';
import {
  makeStarterTarotPageStyles,
  normalizeTarotPageStyle,
  type TarotPageStyle,
} from '../tarot/pageStyle';

export interface SavedTarotPageStyle {
  id: string;
  name: string;
  style: TarotPageStyle;
  starter?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface TarotPageStyleState {
  savedStyles: SavedTarotPageStyle[];
  saveStyle: (name: string, style: TarotPageStyle) => string | null;
  renameStyle: (id: string, name: string) => void;
  deleteStyle: (id: string) => void;
}

const starterStyles = makeStarterTarotPageStyles().map((entry) => ({
  ...entry,
  createdAt: 0,
  updatedAt: 0,
}));

export const useTarotPageStyleStore = createWithEqualityFn<TarotPageStyleState>()(
  persist(
    (set) => ({
      savedStyles: starterStyles,
      saveStyle: (name, style) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const id = uuidv4();
        const now = Date.now();
        set((state) => ({
          savedStyles: [
            ...state.savedStyles,
            { id, name: trimmed, style: normalizeTarotPageStyle(style), createdAt: now, updatedAt: now },
          ],
        }));
        return id;
      },
      renameStyle: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          savedStyles: state.savedStyles.map((entry) => entry.id === id
            ? { ...entry, name: trimmed, updatedAt: Date.now() }
            : entry),
        }));
      },
      deleteStyle: (id) => set((state) => ({
        savedStyles: state.savedStyles.filter((entry) => entry.id !== id || entry.starter),
      })),
    }),
    {
      name: 'designspace-tarot-page-styles',
      storage: createBoundedPersistStorage({ maxBytes: 1024 * 1024 }),
      partialize: (state) => ({ savedStyles: state.savedStyles }),
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState;
        const persisted = persistedState as Partial<TarotPageStyleState>;
        if (!Array.isArray(persisted.savedStyles)) return currentState;
        return {
          ...currentState,
          savedStyles: persisted.savedStyles.map((entry) => ({
            ...entry,
            style: normalizeTarotPageStyle(entry.style),
          })),
        };
      },
    },
  ),
);
