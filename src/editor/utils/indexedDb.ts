
import { IDBPDatabase, openDB } from 'idb';
import type { BrandCollection } from '../state/useThemeStore';

/**
 * Historical auxiliary database compatibility boundary.
 *
 * Design Space no longer uses this database as an active source of truth:
 * templates are owned by DesignSpaceDB.templates, Brand Vault is owned by the
 * persisted theme store, and uploaded stickers are session-only. The database
 * and its rows remain addressable for forensic inspection, migration, or
 * recovery; do not add new production writes here without an explicit
 * migration plan.
 */
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

/** @deprecated Compatibility-only writer retained for historical recovery tooling. */
export async function saveBrandVaultToDb(vault: BrandCollection[]): Promise<void> {
    await ensureDb();
    const tx = db.transaction(BRAND_VAULT_STORE, 'readwrite');
    await tx.store.clear();
    await Promise.all(vault.map(collection => tx.store.put(collection)));
    await tx.done;
}

/** @deprecated Compatibility-only reader; the theme store is the active owner. */
export async function getBrandVaultFromDb(): Promise<BrandCollection[]> {
    await ensureDb();
    return db.getAll(BRAND_VAULT_STORE);
}

/** @deprecated Compatibility-only writer; uploaded sticker collections are session-only. */
export async function addStickerToDb(sticker: StickerData): Promise<IDBValidKey> {
  await ensureDb();
  return db.put(STICKER_STORE, sticker);
}

/** @deprecated Compatibility-only reader retained for recovery inspection. */
export async function getStickersFromDb(): Promise<StickerData[]> {
  await ensureDb();
  return db.getAll(STICKER_STORE);
}

/** @deprecated Compatibility-only mutation retained for recovery tooling. */
export async function deleteStickerFromDb(id: string): Promise<void> {
  await ensureDb();
  return db.delete(STICKER_STORE, id);
}

/** @deprecated Compatibility-only writer; templates are owned by DesignSpaceDB. */
export async function addTemplateToDb(template: TemplateData): Promise<IDBValidKey> {
  await ensureDb();
  return db.put(TEMPLATE_STORE, template);
}

/** @deprecated Compatibility-only reader retained for historical migration. */
export async function getTemplatesFromDb(): Promise<TemplateData[]> {
  await ensureDb();
  return db.getAll(TEMPLATE_STORE);
}

/** @deprecated Compatibility-only reader retained for historical migration. */
export async function getTemplateFromDb(id: string): Promise<TemplateData | undefined> {
  await ensureDb();
  return db.get(TEMPLATE_STORE, id);
}

/** @deprecated Compatibility-only mutation retained for recovery tooling. */
export async function deleteTemplateFromDb(id: string): Promise<void> {
  await ensureDb();
  return db.delete(TEMPLATE_STORE, id);
}
