export const RECOVERY_DELETE_CONFIRMATION = 'DELETE LOCALHOST 5174 DATABASE';
export const RECOVERY_EXTRACT_COMMAND = 'recovery_extract';

export type RecoveryCandidate = {
  id: string;
  browser: string;
  profile: string;
  profilePath: string;
  databasePath: string;
  blobPath: string | null;
  origin: string;
  sizeBytes: number;
  fileCount: number;
  browserRunning: boolean;
};

export type RecoveryDetection = {
  candidates: RecoveryCandidate[];
  exactOrigin: string;
  deleteConfirmation: string;
  auditLogPath: string;
};

export type DestinationReport = {
  destinationPath: string;
  availableBytes: number;
  requiredBytes: number;
  sufficientSpace: boolean;
};

export type BackupReport = {
  backupPath: string;
  manifestPath: string;
  auditLogPath: string;
  totalBytes: number;
  fileCount: number;
  verified: boolean;
};

export type ProjectRecoveryItem = {
  projectId: string;
  name: string;
  path: string;
  bytes: number;
  warnings: string[];
  assetsDeduplicated: number;
  usedOlderRevisionBecauseNewerWasCorrupt: boolean;
  complete: boolean;
};

export type ProjectRecoveryReport = {
  reportPath: string;
  exportRoot: string;
  recordsScanned: number;
  projectsFound: number;
  projectsRecovered: number;
  projectsSkipped: number;
  corruptRecords: number;
  duplicateRevisionsRemoved: number;
  distinctRevisionsSuperseded: number;
  assetsHashed: number;
  assetsDeduplicated: number;
  crossProjectDuplicateAssets: number;
  estimatedDuplicateAssetBytes: number;
  originalBackupBytes: number;
  recoveredExportBytes: number;
  projects: ProjectRecoveryItem[];
  failures: Array<{ projectId?: string; location?: string; reason?: string }>;
  warnings: string[];
};

export type CleanupReport = {
  deletedPaths: string[];
  backupPreservedAt: string;
  logicalBytesReclaimed: number;
  freeBytesBefore: number;
  freeBytesAfter: number;
  sourceAbsent: boolean;
};

export const isTauriRecoveryAvailable = () =>
  typeof window !== 'undefined'
  && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

const invokeRecovery = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRecoveryAvailable()) {
    throw new Error('Filesystem recovery is available only in the Design Space desktop application.');
  }
  // Keep this diagnostic intentionally free of path and project payload values.
  console.info('[Design Space recovery] invoking Tauri command', {
    command,
    argumentNames: Object.keys(args ?? {}),
  });
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error('[Design Space recovery] Tauri command failed', { command, error });
    throw error;
  }
};

export const recoveryErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return fallback;
};

export const recoveryClient = {
  detect: () => invokeRecovery<RecoveryDetection>('recovery_detect'),
  inspectDestination: (databaseId: string, destination: string) =>
    invokeRecovery<DestinationReport>('recovery_inspect_destination', { databaseId, destination }),
  createBackup: (databaseId: string, destination: string, jobId: string) =>
    invokeRecovery<BackupReport>('recovery_create_backup', { databaseId, destination, jobId }),
  verifyBackup: (manifestPath: string) =>
    invokeRecovery<{ valid: boolean; totalBytes: number; fileCount: number }>('recovery_verify_backup', { manifestPath }),
  extract: (manifestPath: string, exportDestination: string, jobId: string) =>
    invokeRecovery<ProjectRecoveryReport>(RECOVERY_EXTRACT_COMMAND, { manifestPath, exportDestination, jobId }),
  cancel: (jobId: string) => invokeRecovery<void>('recovery_cancel', { jobId }),
  deleteOriginal: (databaseId: string, manifestPath: string, confirmation: string) =>
    invokeRecovery<CleanupReport>('recovery_delete_original', { databaseId, manifestPath, confirmation }),
};
