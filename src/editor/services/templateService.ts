import type { TemplateRecord } from '../db';
import { assertIndexedDbStartupAllowed } from '../persistence/startupStorageRecovery';

export type TemplateCanvasSize = { width: number; height: number };

export type SaveTemplateOptions = {
  unitMode?: string;
  defaultThemeId?: string;
  category?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

const DEFAULT_CANVAS_SIZE: TemplateCanvasSize = { width: 2550, height: 3300 };

const getDb = async () => {
  assertIndexedDbStartupAllowed();
  const { db } = await import('../db');
  return db;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toIsoTimestamp = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
};

const normalizeCanvasData = (canvasData: unknown): object => {
  if (isObject(canvasData)) {
    return canvasData;
  }
  if (typeof canvasData === 'string') {
    try {
      const parsed = JSON.parse(canvasData) as unknown;
      if (isObject(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid JSON and fall through to default.
    }
  }
  return { objects: [] };
};

const normalizeCanvasSize = (canvasSize: unknown): TemplateCanvasSize => {
  if (!isObject(canvasSize)) return DEFAULT_CANVAS_SIZE;
  const width = Number(canvasSize.width);
  const height = Number(canvasSize.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return DEFAULT_CANVAS_SIZE;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
};

const sortByUpdatedAtDesc = (records: TemplateRecord[]) =>
  [...records].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || '');
    const bTime = Date.parse(b.updatedAt || '');
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return safeBTime - safeATime;
  });

const buildTemplateRecord = (
  name: string,
  canvasData: unknown,
  canvasSize: TemplateCanvasSize,
  thumbnail: string | undefined,
  options: SaveTemplateOptions,
  now = new Date().toISOString(),
): TemplateRecord => ({
  name,
  thumbnail,
  canvasData: normalizeCanvasData(canvasData),
  canvasSize: normalizeCanvasSize(canvasSize),
  unitMode: options.unitMode,
  defaultThemeId: options.defaultThemeId,
  category: options.category,
  tags: options.tags,
  createdAt: toIsoTimestamp(options.createdAt, now),
  updatedAt: toIsoTimestamp(options.updatedAt, now),
});

export const saveTemplate = async (
  name: string,
  canvasData: unknown,
  canvasSize: TemplateCanvasSize,
  thumbnail?: string,
  options: SaveTemplateOptions = {}
): Promise<TemplateRecord> => {
  const record = buildTemplateRecord(name, canvasData, canvasSize, thumbnail, options);
  const db = await getDb();
  const id = await db.templates.add(record);
  return { ...record, id };
};

export const listTemplates = async (category?: string): Promise<TemplateRecord[]> => {
  const normalizedCategory = category?.trim();
  const db = await getDb();
  const records = normalizedCategory
    ? await db.templates.where('category').equals(normalizedCategory).toArray()
    : await db.templates.toArray();
  return sortByUpdatedAtDesc(records);
};

export const getTemplate = async (id: number): Promise<TemplateRecord | undefined> =>
  (await getDb()).templates.get(id);

export const deleteTemplate = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.templates.delete(id);
};

export const duplicateTemplate = async (id: number, newName: string): Promise<TemplateRecord> => {
  const source = await getTemplate(id);
  if (!source) {
    throw new Error(`Template not found: ${id}`);
  }

  return saveTemplate(
    newName,
    source.canvasData,
    source.canvasSize,
    source.thumbnail,
    {
      unitMode: source.unitMode,
      defaultThemeId: source.defaultThemeId,
      category: source.category,
      tags: source.tags,
    }
  );
};

type PersistPayload = {
  state?: Record<string, unknown>;
  [key: string]: unknown;
};

const LEGACY_VOLATILE_EDITOR_KEYS = [
  'userTemplates',
  'assets',
  'pages',
  'activePageIndex',
  'productProjectFields',
  'isDirty',
  'autoSaveStatus',
  'saveStatus',
] as const;

const removeLegacyVolatileEditorKeys = (payload: unknown): string | null => {
  if (!isObject(payload)) return null;

  const parsedPayload = payload as PersistPayload;
  if (isObject(parsedPayload.state)) {
    const nextState = { ...parsedPayload.state };
    const changed = LEGACY_VOLATILE_EDITOR_KEYS.some((key) => {
      if (!(key in nextState)) return false;
      delete nextState[key];
      return true;
    });
    if (!changed) return null;
    return JSON.stringify({ ...parsedPayload, state: nextState });
  }

  const nextPayload: Record<string, unknown> = { ...parsedPayload };
  const changed = LEGACY_VOLATILE_EDITOR_KEYS.some((key) => {
    if (!(key in nextPayload)) return false;
    delete nextPayload[key];
    return true;
  });
  if (changed) return JSON.stringify(nextPayload);

  return null;
};

export const migrateFromLocalStorage = async (): Promise<TemplateRecord[]> => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  const raw = window.localStorage.getItem('designspace-editor');
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  const parsedObject = isObject(parsed) ? parsed : null;
  const stateCandidate = parsedObject && isObject(parsedObject.state)
    ? parsedObject.state
    : parsedObject;
  const userTemplates = stateCandidate && Array.isArray(stateCandidate.userTemplates)
    ? stateCandidate.userTemplates
    : [];

  const migrationRecords: TemplateRecord[] = [];
  for (let index = 0; index < userTemplates.length; index += 1) {
    const item = userTemplates[index];
    if (!isObject(item)) continue;

    const name = typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name
      : `Migrated Template ${index + 1}`;
    const thumbnail = typeof item.thumbnail === 'string' ? item.thumbnail : undefined;
    migrationRecords.push(buildTemplateRecord(
      name,
      item.canvasData,
      normalizeCanvasSize(item.canvasSize),
      thumbnail,
      {
        unitMode: typeof item.unitMode === 'string' ? item.unitMode : undefined,
        defaultThemeId: typeof item.defaultThemeId === 'string' ? item.defaultThemeId : undefined,
        category: typeof item.category === 'string' ? item.category : undefined,
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === 'string')
          : undefined,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
      },
    ));
  }

  // Migrate the complete batch in one transaction.  The legacy source is
  // intentionally rewritten only after this commits, so an injected failure
  // cannot leave a partial template batch that would be duplicated on retry.
  const db = await getDb();
  const migrated = await db.transaction('rw', db.templates, async () => {
    const saved: TemplateRecord[] = [];
    for (const record of migrationRecords) {
      const id = await db.templates.add(record);
      saved.push({ ...record, id: id as number });
    }
    return saved;
  });

  const updatedPayload = removeLegacyVolatileEditorKeys(parsed);
  if (updatedPayload) {
    window.localStorage.setItem('designspace-editor', updatedPayload);
  }

  return migrated;
};
