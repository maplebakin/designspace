import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { captureCanvasState } from '../src/editor/utils/serialization';
import { isPersistableCanvasObject, isUserObject } from '../src/editor/utils/objectUtils';
import { useCanvasStore } from '../src/editor/state/useCanvasStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';

const repoRoot = process.cwd();
const editorRoot = join(repoRoot, 'src/editor');

const readSourceFiles = (dir: string): Array<{ path: string; text: string }> => {
  const entries: Array<{ path: string; text: string }> = [];

  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...readSourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    entries.push({ path: relative(repoRoot, path), text: readFileSync(path, 'utf8') });
  }

  return entries;
};

const createSerializableObject = (props: Record<string, unknown>) => ({
  type: props.type ?? 'rect',
  ...props,
  toObject: () => ({ ...props }),
});

describe('editor state integrity harness', () => {
  beforeEach(() => {
    useCanvasStore.setState({ width: 800, height: 600, hasPendingSize: false });
    useHistoryStore.getState().resetHistory();
  });

  describe('object classification', () => {
    it('treats normal design objects as user and persistable objects', () => {
      const designObject = { id: 'shape-1', type: 'rect' };

      expect(isUserObject(designObject)).toBe(true);
      expect(isPersistableCanvasObject(designObject)).toBe(true);
    });

    it('excludes guide, document paper, and export-excluded objects from user object checks', () => {
      expect(isUserObject({ id: 'guide', isGuide: true })).toBe(false);
      expect(isUserObject({ id: 'paper', isDocumentPaper: true })).toBe(false);
      expect(isUserObject({ id: 'hidden-export', excludeFromExport: true })).toBe(false);
    });

    it('keeps page borders persistable without treating them as ordinary scalable content', () => {
      const pageBorder = { id: 'border', type: 'group', isPageBorder: true };

      expect(isUserObject(pageBorder)).toBe(false);
      expect(isPersistableCanvasObject(pageBorder)).toBe(true);
    });
  });

  describe('serialization and persistence invariants', () => {
    it('captures document size from useCanvasStore and preserves page background', () => {
      useCanvasStore.getState().setCanvasSize(1234, 567);
      const canvas = {
        backgroundColor: 'transparent',
        viewportTransform: [2, 0, 0, 2, 10, 20],
        setViewportTransform: () => undefined,
        toDataURL: () => 'data:image/png;base64,AAAA',
        getObjects: () => [
          createSerializableObject({ id: 'shape', type: 'rect', fill: '#123456' }),
        ],
      };

      const captured = captureCanvasState(canvas as any, { backgroundColor: '#f8f8f8' });
      const parsed = JSON.parse(captured.canvasData);

      expect(captured.canvasSize).toEqual({ width: 1234, height: 567 });
      expect(parsed.background).toBe('#f8f8f8');
      expect(parsed.objects).toHaveLength(1);
      expect(parsed.objects[0].id).toBe('shape');
    });

    it('persists page borders while excluding guides, document paper, temporary, and export-excluded objects', () => {
      const canvas = {
        backgroundColor: '#ffffff',
        viewportTransform: [1, 0, 0, 1, 0, 0],
        setViewportTransform: () => undefined,
        toDataURL: () => 'data:image/png;base64,AAAA',
        getObjects: () => [
          createSerializableObject({ id: 'shape', type: 'rect' }),
          createSerializableObject({ id: 'border', type: 'group', isPageBorder: true }),
          createSerializableObject({ id: 'guide', type: 'line', isGuide: true }),
          createSerializableObject({ id: 'paper', type: 'rect', isDocumentPaper: true }),
          createSerializableObject({ id: 'temp', type: 'rect', isTemporary: true }),
          createSerializableObject({ id: 'no-export', type: 'rect', excludeFromExport: true }),
        ],
      };

      const captured = captureCanvasState(canvas as any, { backgroundColor: '#ffffff' });
      const parsed = JSON.parse(captured.canvasData);

      expect(parsed.objects.map((object: { id: string }) => object.id)).toEqual(['shape', 'border']);
    });
  });

  describe('history ownership', () => {
    it('keeps undo disabled after a baseline snapshot and enables it after a real edit snapshot', () => {
      const history = useHistoryStore.getState();

      history.pushSnapshot(JSON.stringify({ type: 'full', data: { objects: [] } }), { force: true });
      expect(useHistoryStore.getState().canUndo()).toBe(false);
      expect(useHistoryStore.getState().canRedo()).toBe(false);

      history.pushSnapshot(
        JSON.stringify({ type: 'full', data: { objects: [{ id: 'shape', type: 'rect' }] } }),
        { force: true }
      );

      expect(useHistoryStore.getState().canUndo()).toBe(true);
      expect(useHistoryStore.getState().undoSnapshot()).toContain('"objects":[]');
      expect(useHistoryStore.getState().canRedo()).toBe(true);
      expect(useHistoryStore.getState().redoSnapshot()).toContain('"shape"');
    });

    it('does not import removed legacy history owners in live editor source', () => {
      const offenders = readSourceFiles(editorRoot)
        .filter(({ text }) => /historySnapshotManager|historySnapshots|historyService|hooks\/useHistory/.test(text))
        .map(({ path }) => path);

      expect(offenders).toEqual([]);
    });
  });

  describe('export routing and page deletion guardrails', () => {
    it('does not import legacy export helpers in live editor source', () => {
      const offenders = readSourceFiles(editorRoot)
        .filter(({ text }) => /fabric\/exportCanvas|fabric\/exportUtils|utils\/advancedExports|utils\/canvasOperations/.test(text))
        .map(({ path }) => path);

      expect(offenders).toEqual([]);
    });

    it('keeps editor and modal exports routed through AdvancedExportManager', () => {
      const editorStore = readFileSync(join(editorRoot, 'state/editorStore.ts'), 'utf8');
      const exportModal = readFileSync(join(editorRoot, 'components/ExportModal.tsx'), 'utf8');

      expect(editorStore).toContain("import { advancedExportManager } from '../export/advancedExportManager'");
      expect(editorStore).toContain('advancedExportManager.export(canvas, options.format');
      expect(exportModal).toContain('advancedExportManager.export(canvas, format');
      expect(exportModal).toContain('advancedExportManager.exportPagesPdf');
    });

    it('prevents page deletion from saving the old canvas into the newly active page', () => {
      const editorStore = readFileSync(join(editorRoot, 'state/editorStore.ts'), 'utf8');

      expect(editorStore).toContain('switchToPage: async (index, options)');
      expect(editorStore).toContain('options?.saveCurrent !== false');
      expect(editorStore).toContain('switchToPage(safeNextIndex, { saveCurrent: false })');
    });
  });
});
