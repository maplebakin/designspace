import { expect, test, chromium } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const originPort = Number(process.env.DESIGN_SPACE_E2E_PORT ?? 5174);

const findOriginDirectory = (root: string, suffix: string): string | null => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name.includes(`localhost_${originPort}`) && entry.name.endsWith(suffix)) return path;
    if (entry.isDirectory()) {
      const found = findOriginDirectory(path, suffix);
      if (found) return found;
    }
  }
  return null;
};

const treeHash = (root: string) => {
  const digest = createHash('sha256');
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      digest.update(entry.name);
      if (entry.isDirectory()) visit(path);
      else digest.update(readFileSync(path));
    }
  };
  visit(root);
  return digest.digest('hex');
};

test('forensic reader recovers a real Chromium IndexedDB copy without modifying it', async () => {
  test.setTimeout(60_000);
  const root = mkdtempSync(join(tmpdir(), 'design-space-real-idb-fixture-'));
  const profile = join(root, 'profile');
  const backup = join(root, 'verified-backup');
  const exports = join(root, 'exports');
  const context = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('/');
    await expect(page.getByText('No product projects yet.')).toBeVisible();
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('DesignSpaceDB');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const payload = JSON.stringify({
        schemaVersion: 'design-space-project-v2',
        editorMode: 'canvas',
        projectId: 'real-fixture-project',
        projectName: 'Real IndexedDB Fixture',
        updatedAt: '2026-07-22T12:00:00.000Z',
        lastUpdated: '2026-07-22T12:00:00.000Z',
        pages: [{
          kind: 'canvas', id: 'page-1', name: 'Page 1',
          canvasData: { objects: [{ type: 'rect', id: 'fixture-shape', fill: '#336699' }] },
          canvasSize: { width: 800, height: 600 },
        }],
        canvasData: { objects: [{ type: 'rect', id: 'fixture-shape', fill: '#336699' }] },
        canvasSize: { width: 800, height: 600 },
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['projects', 'canvasData'], 'readwrite');
        tx.objectStore('projects').put({
          id: 'real-fixture-project', name: 'Real IndexedDB Fixture',
          lastModified: new Date('2026-07-22T12:00:00.000Z'), canvasDataId: 'real-fixture-canvas',
        });
        tx.objectStore('canvasData').put({
          id: 'real-fixture-canvas', projectId: 'real-fixture-project', jsonPayload: payload,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    });
  } finally {
    await context.close();
  }

  try {
    const leveldb = findOriginDirectory(profile, '.indexeddb.leveldb');
    expect(leveldb).not.toBeNull();
    mkdirSync(join(backup, 'source'), { recursive: true });
    cpSync(leveldb!, join(backup, 'source', 'leveldb'), { recursive: true });
    const blob = findOriginDirectory(profile, '.indexeddb.blob');
    if (blob) cpSync(blob, join(backup, 'source', 'blob'), { recursive: true });
    const before = treeHash(join(backup, 'source', 'leveldb'));

    const result = spawnSync('python3', [
      join(process.cwd(), 'src-tauri/recovery_tools/recover_indexeddb.py'),
      '--backup-root', backup,
      '--export-root', exports,
      '--source-profile', 'Chromium Fixture / Default',
    ], { encoding: 'utf-8', timeout: 30_000 });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(treeHash(join(backup, 'source', 'leveldb'))).toBe(before);
    const report = JSON.parse(readFileSync(join(exports, 'recovery-report.json'), 'utf-8'));
    expect(report.projectsRecovered).toBe(1);
    const projectPath = report.projects[0].path as string;
    expect(existsSync(projectPath)).toBe(true);
    const recovered = JSON.parse(readFileSync(projectPath, 'utf-8'));
    expect(recovered.projectName).toBe('Real IndexedDB Fixture');
    expect(recovered.canvasData.objects[0]).toMatchObject({ id: 'fixture-shape', fill: '#336699' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
