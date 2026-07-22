import { expect, test } from '@playwright/test';

test('desktop recovery workspace requires verified backup, recovery report, and exact destructive confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    const callbacks = new Map<number, (...args: any[]) => void>();
    let callbackId = 1;
    (window as any).__recoveryCalls = calls;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: (...args: any[]) => void) => {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: any) => {
        calls.push(command);
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') return undefined;
        if (command === 'recovery_detect') return {
          exactOrigin: 'localhost:5174',
          deleteConfirmation: 'DELETE LOCALHOST 5174 DATABASE',
          auditLogPath: '/home/test/.local/share/com.designspace.app/browser-recovery-audit.jsonl',
          candidates: [{
            id: 'candidate-1', browser: 'Google Chrome', profile: 'Default',
            profilePath: '/home/test/.config/google-chrome/Default',
            databasePath: '/home/test/.config/google-chrome/Default/IndexedDB/http_localhost_5174.indexeddb.leveldb',
            blobPath: '/home/test/.config/google-chrome/Default/IndexedDB/http_localhost_5174.indexeddb.blob',
            origin: 'localhost:5174', sizeBytes: 17 * 1024 ** 3, fileCount: 85, browserRunning: false,
          }],
        };
        if (command === 'recovery_inspect_destination') return {
          destinationPath: '/safe/recovery', availableBytes: 40 * 1024 ** 3,
          requiredBytes: 17.5 * 1024 ** 3, sufficientSpace: true,
        };
        if (command === 'recovery_create_backup') return {
          backupPath: '/safe/recovery/verified-backup',
          manifestPath: '/safe/recovery/verified-backup/backup-manifest.json',
          auditLogPath: '/safe/recovery/verified-backup/recovery-audit.jsonl',
          totalBytes: 17 * 1024 ** 3, fileCount: 85, verified: true,
        };
        if (command === 'recovery_verify_backup') return { valid: true, totalBytes: 17 * 1024 ** 3, fileCount: 85 };
        if (command === 'recovery_extract') return {
          reportPath: '/safe/recovery/exports/recovery-report.json', exportRoot: '/safe/recovery/exports',
          recordsScanned: 1200, projectsFound: 3, projectsRecovered: 2, projectsSkipped: 1,
          corruptRecords: 2, duplicateRevisionsRemoved: 1100, distinctRevisionsSuperseded: 4,
          assetsHashed: 8, assetsDeduplicated: 3, crossProjectDuplicateAssets: 2,
          estimatedDuplicateAssetBytes: 1024, originalBackupBytes: 17 * 1024 ** 3,
          recoveredExportBytes: 3 * 1024 ** 2, warnings: [], failures: [],
          projects: [{
            projectId: 'p1', name: 'Recovered Planner', path: '/safe/recovery/exports/recovered-planner.apocaproject.json',
            bytes: 2 * 1024 ** 2, warnings: [], assetsDeduplicated: 2,
            usedOlderRevisionBecauseNewerWasCorrupt: true, complete: true,
          }],
        };
        if (command === 'recovery_delete_original') {
          if (args.confirmation !== 'DELETE LOCALHOST 5174 DATABASE') throw new Error('wrong confirmation');
          return {
            deletedPaths: [args.databasePath], backupPreservedAt: '/safe/recovery/verified-backup',
            logicalBytesReclaimed: 17 * 1024 ** 3, freeBytesBefore: 20 * 1024 ** 3,
            freeBytesAfter: 37 * 1024 ** 3, sourceAbsent: true,
          };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  });

  await page.goto('/');
  await expect(page.getByTestId('recovery-workspace')).toBeVisible();
  await expect(page.getByTestId('recovery-database-path')).toContainText('http_localhost_5174.indexeddb.leveldb');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.getByTestId('recovery-check-space').click();
  await expect(page.getByTestId('recovery-space-status')).toContainText('available');
  await page.getByTestId('recovery-create-backup').click();
  await expect(page.getByText('SHA-256 verified')).toBeVisible();
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.getByTestId('recovery-extract').click();
  await expect(page.getByTestId('recovery-report')).toContainText('1200');
  await expect(page.getByTestId('recovery-report')).toContainText('Recovered Planner');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.getByTestId('recovery-delete-confirmation').fill('DELETE LOCALHOST 5174');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();
  await page.getByTestId('recovery-delete-confirmation').fill('DELETE LOCALHOST 5174 DATABASE');
  await expect(page.getByTestId('recovery-delete-original')).toBeEnabled();
  await page.getByTestId('recovery-delete-original').click();
  await expect(page.getByTestId('recovery-cleanup-complete')).toContainText('Backup preserved');

  const calls = await page.evaluate(() => (window as any).__recoveryCalls as string[]);
  expect(calls.filter((command) => command === 'recovery_delete_original')).toHaveLength(1);
});
