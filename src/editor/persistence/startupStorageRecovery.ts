const MIB = 1024 * 1024;

export const MAX_SAFE_ORIGIN_STORAGE_BYTES = 1024 * MIB;
export const STORAGE_RECOVERY_MARKER_KEY = 'designspace-storage-recovery-v1';
export const TEMPLATE_MIGRATION_FLAG_KEY = 'designspace-template-migration-v1';
export const LOCAL_STORAGE_RECOVERY_PREFIX = 'designspace-recovery:';

type LocalStorageRule = {
  key: string;
  maxBytes: number;
};

const LOCAL_STORAGE_RULES: LocalStorageRule[] = [
  // The larger editor allowance exists only so old templates can be migrated.
  { key: 'designspace-editor', maxBytes: 8 * MIB },
  { key: 'designspace-theme', maxBytes: 4 * MIB },
  { key: 'designspace-ui-theme', maxBytes: 256 * 1024 },
  { key: 'designspace-vision-board', maxBytes: 8 * MIB },
  { key: 'designspace_recent_colors', maxBytes: 64 * 1024 },
];

export type QuarantinedStorageEntry = {
  key: string;
  recoveryKey: string;
  reason: 'corrupt-json' | 'oversized';
  bytes: number;
};

export type StartupStorageStatus = {
  indexedDbBlocked: boolean;
  reason: 'healthy' | 'origin-storage-oversized' | 'storage-estimate-failed';
  usageBytes: number | null;
  quotaBytes: number | null;
  quarantinedLocalStorage: QuarantinedStorageEntry[];
  migrationError?: string;
};

let startupStatus: StartupStorageStatus = {
  indexedDbBlocked: false,
  reason: 'healthy',
  usageBytes: null,
  quotaBytes: null,
  quarantinedLocalStorage: [],
};

const storageBytes = (value: string) => value.length * 2;

const recoveryKeyFor = (key: string) =>
  `${LOCAL_STORAGE_RECOVERY_PREFIX}${key}:${new Date().toISOString()}`;

export const quarantineLocalStorageValue = (
  storage: Storage,
  key: string,
  raw: string,
  reason: QuarantinedStorageEntry['reason']
): QuarantinedStorageEntry | null => {
  const recoveryKey = recoveryKeyFor(key);
  storage.removeItem(key);
  try {
    storage.setItem(recoveryKey, raw);
    return {
      key,
      recoveryKey,
      reason,
      bytes: storageBytes(raw),
    };
  } catch {
    // Moving rather than copying normally fits because the active value was
    // removed first. If even that fails, restore it rather than lose user data.
    try {
      storage.setItem(key, raw);
    } catch {
      // The browser owns the original storage failure; there is no safe write
      // available here. The caller will still start without hydrating the value.
    }
    return null;
  }
};

const inspectLocalStorage = (): QuarantinedStorageEntry[] => {
  if (typeof window === 'undefined') return [];
  const quarantined: QuarantinedStorageEntry[] = [];

  for (const rule of LOCAL_STORAGE_RULES) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(rule.key);
    } catch {
      continue;
    }
    if (raw === null) continue;

    const bytes = storageBytes(raw);
    let reason: QuarantinedStorageEntry['reason'] | null = null;
    if (bytes > rule.maxBytes) {
      reason = 'oversized';
    } else {
      try {
        JSON.parse(raw);
      } catch {
        reason = 'corrupt-json';
      }
    }
    if (!reason) continue;

    const result = quarantineLocalStorageValue(
      window.localStorage,
      rule.key,
      raw,
      reason
    );
    if (result) quarantined.push(result);
  }

  return quarantined;
};

const writeRecoveryMarker = (status: StartupStorageStatus) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_RECOVERY_MARKER_KEY, JSON.stringify({
      reason: status.reason,
      usageBytes: status.usageBytes,
      quotaBytes: status.quotaBytes,
      detectedAt: new Date().toISOString(),
      // IndexedDB remains untouched and is therefore the recovery copy.
      dataPreservedInPlace: true,
    }));
  } catch {
    // The recovery gate remains active in memory even if storage is full.
  }
};

const inspectOriginStorage = async (): Promise<Pick<StartupStorageStatus,
  'indexedDbBlocked' | 'reason' | 'usageBytes' | 'quotaBytes'>> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      indexedDbBlocked: false,
      reason: 'healthy',
      usageBytes: null,
      quotaBytes: null,
    };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    const quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
    const indexedDbBlocked = usageBytes !== null
      && usageBytes > MAX_SAFE_ORIGIN_STORAGE_BYTES;
    return {
      indexedDbBlocked,
      reason: indexedDbBlocked ? 'origin-storage-oversized' : 'healthy',
      usageBytes,
      quotaBytes,
    };
  } catch {
    return {
      indexedDbBlocked: true,
      reason: 'storage-estimate-failed',
      usageBytes: null,
      quotaBytes: null,
    };
  }
};

export const prepareStartupStorage = async (): Promise<StartupStorageStatus> => {
  const quarantinedLocalStorage = inspectLocalStorage();
  const origin = await inspectOriginStorage();
  startupStatus = { ...origin, quarantinedLocalStorage };

  if (startupStatus.indexedDbBlocked) {
    writeRecoveryMarker(startupStatus);
    return startupStatus;
  }

  if (
    typeof window !== 'undefined'
    && window.localStorage.getItem(TEMPLATE_MIGRATION_FLAG_KEY) !== 'done'
  ) {
    try {
      const { migrateFromLocalStorage } = await import('../services/templateService');
      await migrateFromLocalStorage();
      window.localStorage.setItem(TEMPLATE_MIGRATION_FLAG_KEY, 'done');
    } catch (error) {
      startupStatus = {
        ...startupStatus,
        migrationError: error instanceof Error ? error.message : 'Template migration failed.',
      };
    }
  }

  return startupStatus;
};

export const getStartupStorageStatus = () => startupStatus;

export const assertIndexedDbStartupAllowed = () => {
  if (!startupStatus.indexedDbBlocked) return;
  throw new Error(
    'The browser library is in recovery mode because its storage is unusually large or unreadable.'
  );
};
