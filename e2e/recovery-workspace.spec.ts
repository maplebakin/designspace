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
        if (command === 'recovery_discover_backups') {
          const hasBackup = localStorage.getItem('mockVerifiedBackup') === 'true';
          const hasReport = localStorage.getItem('mockRecoveryCompleted') === 'true';
          const report = hasReport ? {
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
          } : null;
          const backup = {
            id: 'backup-1',
            backupPath: '/safe/recovery/verified-backup',
            manifestPath: '/safe/recovery/verified-backup/backup-manifest.json',
            auditLogPath: '/safe/recovery/verified-backup/recovery-audit.jsonl',
            totalBytes: 17 * 1024 ** 3,
            fileCount: 85,
            verified: true,
            previouslyVerified: true,
            fastValidationPassed: true,
            requiresFullVerification: false,
            createdAt: '2026-07-23T10:00:00Z',
            status: hasReport ? 'Recovery report found' : 'Fast validation passed',
            rejectionReason: null,
            report,
            recoveryCompleted: hasReport,
            lastFailure: localStorage.getItem('mockLastFailure'),
          };
          return {
            backups: hasBackup ? [backup] : [],
            selectedManifestPath: hasBackup ? backup.manifestPath : null,
            searchedRoots: ['/safe/recovery'],
            sessionPath: '/home/test/.local/share/com.designspace.app/browser-recovery-session.json',
          };
        }
        if (command === 'recovery_inspect_destination') return {
          destinationPath: '/safe/recovery', availableBytes: 40 * 1024 ** 3,
          requiredBytes: 17.5 * 1024 ** 3, sufficientSpace: true,
        };
        if (command === 'recovery_create_backup') {
          localStorage.setItem('mockVerifiedBackup', 'true');
          localStorage.setItem('mockBackupCopies', String(Number(localStorage.getItem('mockBackupCopies') ?? '0') + 1));
          return {
            backupPath: '/safe/recovery/verified-backup',
            manifestPath: '/safe/recovery/verified-backup/backup-manifest.json',
            auditLogPath: '/safe/recovery/verified-backup/recovery-audit.jsonl',
            totalBytes: 17 * 1024 ** 3, fileCount: 85, verified: true,
          };
        }
        if (command === 'recovery_verify_backup') return { valid: true, totalBytes: 17 * 1024 ** 3, fileCount: 85 };
        if (command === 'recovery_extract') {
          (window as any).__recoveryExtractArgs = args;
          localStorage.setItem('mockExtractArgs', JSON.stringify(args));
          localStorage.setItem('mockExtractCalls', String(Number(localStorage.getItem('mockExtractCalls') ?? '0') + 1));
          if (localStorage.getItem('mockFailRecovery') === 'true') {
            localStorage.setItem('mockLastFailure', 'Configured Python executable does not exist: /missing/python3');
            throw 'Configured Python executable does not exist: /missing/python3';
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          localStorage.setItem('mockRecoveryCompleted', 'true');
          localStorage.removeItem('mockLastFailure');
          return {
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
        }
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
  await expect(page.getByTestId('recovery-extract-precondition')).toContainText('verified backup is required');

  await page.getByTestId('recovery-check-space').click();
  await expect(page.getByTestId('recovery-space-status')).toContainText('available');
  await page.getByTestId('recovery-create-backup').click();
  await expect(page.getByText('SHA-256 verified')).toBeVisible();
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId('recovery-resume-status')).toContainText('Existing verified backup found');
  await expect(page.getByText('SHA-256 verified')).toBeVisible();
  await expect(page.getByTestId('recovery-create-backup')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mockBackupCopies'))).toBe('1');

  await page.evaluate(() => localStorage.setItem('mockFailRecovery', 'true'));
  await page.getByTestId('recovery-extract').click();
  await expect(page.getByTestId('recovery-error')).toContainText('Configured Python executable does not exist');
  await expect(page.getByTestId('recovery-error')).toContainText('recovery-audit.jsonl');
  await expect(page.getByTestId('recovery-extract')).toBeEnabled();
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId('recovery-error')).toContainText('Previous recovery attempt failed');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();
  await page.evaluate(() => localStorage.removeItem('mockFailRecovery'));
  await page.getByTestId('recovery-extract').evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByTestId('recovery-extract')).toContainText('Recovering');
  await expect(page.getByTestId('recovery-progress')).toContainText('Validating the verified backup');
  await expect(page.getByTestId('recovery-report')).toContainText('1200');
  await expect(page.getByTestId('recovery-report')).toContainText('Recovered Planner');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId('recovery-resume-status')).toContainText('Recovery report found');
  await expect(page.getByTestId('recovery-report')).toContainText('Recovered Planner');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();

  await page.getByTestId('recovery-delete-confirmation').fill('DELETE LOCALHOST 5174');
  await expect(page.getByTestId('recovery-delete-original')).toBeDisabled();
  await page.getByTestId('recovery-delete-confirmation').fill('DELETE LOCALHOST 5174 DATABASE');
  await expect(page.getByTestId('recovery-delete-original')).toBeEnabled();
  await page.getByTestId('recovery-delete-original').click();
  await expect(page.getByTestId('recovery-cleanup-complete')).toContainText('Backup preserved');

  const calls = await page.evaluate(() => (window as any).__recoveryCalls as string[]);
  const extractArgs = JSON.parse(await page.evaluate(() => localStorage.getItem('mockExtractArgs') ?? '{}')) as Record<string, unknown>;
  expect(Object.keys(extractArgs).sort()).toEqual(['exportDestination', 'jobId', 'manifestPath']);
  expect(extractArgs.manifestPath).toBe('/safe/recovery/verified-backup/backup-manifest.json');
  expect(await page.evaluate(() => localStorage.getItem('mockExtractCalls'))).toBe('2');
  expect(calls.filter((command) => command === 'recovery_delete_original')).toHaveLength(1);
});
