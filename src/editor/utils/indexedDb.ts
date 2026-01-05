
import { IDBPDatabase, openDB } from 'idb';
import { BrandCollection } from '../state/editorStore';

const DB_NAME = 'witchclick_assets_db';
const DB_VERSION = 3;
const STICKER_STORE = 'custom_stickers';
const TEMPLATE_STORE = 'templates';
const BRAND_VAULT_STORE = 'brand_vault';

interface StickerData {
  id: string;
  name: string;
  imageUrl: string; // Data URL or Blob URL
  tags: string[];
  category: string;
}

export interface TemplateData {
  id: string;
  name: string;
  json: Record<string, any>;
  unitMode: 'px' | 'in';
  themeName: string | null;
  thumbnail?: string;
  createdAt: number;
}

let db: IDBPDatabase;

async function openAssetDb() {
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STICKER_STORE)) {
        database.createObjectStore(STICKER_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
        database.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(BRAND_VAULT_STORE)) {
        database.createObjectStore(BRAND_VAULT_STORE, { keyPath: 'id' });
      }
    },
  });
}

async function ensureDb() {
  if (!db) {
    await openAssetDb();
  }
}

export async function saveBrandVaultToDb(vault: BrandCollection[]): Promise<void> {
    await ensureDb();
    const tx = db.transaction(BRAND_VAULT_STORE, 'readwrite');
    await tx.store.clear();
    await Promise.all(vault.map(collection => tx.store.put(collection)));
    await tx.done;
}

export async function getBrandVaultFromDb(): Promise<BrandCollection[]> {
    await ensureDb();
    return db.getAll(BRAND_VAULT_STORE);
}

export async function addStickerToDb(sticker: StickerData): Promise<IDBValidKey> {
  await ensureDb();
  return db.put(STICKER_STORE, sticker);
}

export async function getStickersFromDb(): Promise<StickerData[]> {
  await ensureDb();
  return db.getAll(STICKER_STORE);
}

export async function deleteStickerFromDb(id: string): Promise<void> {
  await ensureDb();
  return db.delete(STICKER_STORE, id);
}

export async function addTemplateToDb(template: TemplateData): Promise<IDBValidKey> {
  await ensureDb();
  return db.put(TEMPLATE_STORE, template);
}

export async function getTemplatesFromDb(): Promise<TemplateData[]> {
  await ensureDb();
  return db.getAll(TEMPLATE_STORE);
}

export async function getTemplateFromDb(id: string): Promise<TemplateData | undefined> {
  await ensureDb();
  return db.get(TEMPLATE_STORE, id);
}

export async function deleteTemplateFromDb(id: string): Promise<void> {
  await ensureDb();
  return db.delete(TEMPLATE_STORE, id);
}
