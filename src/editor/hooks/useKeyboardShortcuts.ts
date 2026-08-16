import { useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import * as objectFactories from '../fabric/objectFactories';
import { copySelection, pasteFromClipboard, duplicateSelection } from '../services/clipboardService';
import { zoomToSelection } from '../utils/zoomToSelection';
import { isActiveSelection } from '../utils/typeGuards';

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
};

const isTextEditing = (object: fabric.Object | null) => {
  if (!object) return false;
  if (object.type === 'i-text' || object.type === 'textbox') {
    return !!(object as fabric.IText).isEditing;
  }
  return false;
};

export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const {
        canvas,
        undo,
        redo,
        removeSelectedObject,
        requestLayerSync,
        syncCanvasToStore,
        saveState,
        getCanvasGeometrySnapshot,
        reportCommittedCanvasGeometry,
        reportCommittedCanvasPageGeometry,
      } =
        useEditorStore.getState();
      if (!canvas) return;

      const activeObject = canvas.getActiveObject() ?? null;
      if (isTextEditing(activeObject)) return;

      const isMeta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isMeta && key === 'k') {
        event.preventDefault();
        const { setProjectQuickOpenOpen } = useEditorStore.getState();
        setProjectQuickOpenOpen(true);
        return;
      }

      if (isMeta && key === 'e') {
        event.preventDefault();
        const { setShowExportModal } = useEditorStore.getState();
        setShowExportModal(true);
        return;
      }

      if (isMeta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey || event.key === 'Z') {
          void redo();
        } else {
          void undo();
        }
        return;
      }

      // Zoom to selection (mapped to key '3')
      if (key === '3') {
        event.preventDefault();
        const { canvas } = useEditorStore.getState();
        if (canvas) {
          zoomToSelection(canvas, 50); // 50px padding
        }
        return;
      }

      // Show keyboard shortcut help (mapped to Ctrl+Shift+/ or Cmd+Shift+/)
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '/') {
        event.preventDefault();
        const { setShowHelpModal } = useEditorStore.getState();
        setShowHelpModal(true);
        return;
      }

      // Clipboard shortcuts (⌘C, ⌘V, ⌘D)
      if (isMeta && key === 'c' && activeObject) {
        event.preventDefault();
        void copySelection();
        return;
      }

      if (isMeta && key === 'v') {
        event.preventDefault();
        void pasteFromClipboard();
        return;
      }

      if (isMeta && key === 'd' && activeObject) {
        event.preventDefault();
        void duplicateSelection();
        return;
      }

      if (!isMeta && !event.altKey) {
        // Tool shortcuts
        if (key === 'v') {
          event.preventDefault();
          useEditorStore.getState().setActiveTool('select');
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          useEditorStore.getState().setActiveTool('erase');
          return;
        }
        if (key === 'p') {
          event.preventDefault();
          useEditorStore.getState().setActiveTool('draw');
          return;
        }
        if (key === 'h') {
          event.preventDefault();
          useEditorStore.getState().setActiveTool('pan');
          return;
        }

        // Shape shortcuts
        if (key === 'r') {
          event.preventDefault();
          objectFactories.addRectangle(canvas);
          useEditorStore.getState().setActiveTool('select');
          return;
        }
        if (key === 'c') {
          event.preventDefault();
          objectFactories.addCircle(canvas);
          useEditorStore.getState().setActiveTool('select');
          return;
        }
        if (key === 's') {
          event.preventDefault();
          objectFactories.addStar(canvas);
          useEditorStore.getState().setActiveTool('select');
          return;
        }
        if (key === 't') {
          event.preventDefault();
          useEditorStore.getState().setActiveTool('textbox');
          return;
        }
        if (key === 'g') {
          event.preventDefault();
          const { gridEnabled, setGridEnabled } = useEditorStore.getState();
          setGridEnabled(!gridEnabled);
          return;
        }

        // Escape to deselect
        if (key === 'escape') {
          event.preventDefault();
          useEditorStore.getState().clearSelection();
          return;
        }
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!activeObject) return;
        event.preventDefault();
        removeSelectedObject();
        return;
      }

      // Grouping and ungrouping shortcuts
      if (isMeta && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          // Shift+Cmd+G = Ungroup
          const { ungroupSelectedObjects } = useEditorStore.getState();
          ungroupSelectedObjects();
        } else {
          // Cmd+G = Group
          const { groupSelectedObjects } = useEditorStore.getState();
          groupSelectedObjects();
        }
        return;
      }

      if (!activeObject) return;

      // Handle nudging with arrow keys
      let deltaX = 0;
      let deltaY = 0;
      const nudgeAmount = event.shiftKey ? 10 : 1; // Shift increases nudge amount

      switch (event.key) {
        case 'ArrowUp':
          deltaY = -nudgeAmount;
          break;
        case 'ArrowDown':
          deltaY = nudgeAmount;
          break;
        case 'ArrowLeft':
          deltaX = -nudgeAmount;
          break;
        case 'ArrowRight':
          deltaX = nudgeAmount;
          break;
        default:
          return;
      }

      event.preventDefault();

      const beforeGeometry = getCanvasGeometrySnapshot();

      const lockedX = !!(activeObject as any).lockMovementX;
      const lockedY = !!(activeObject as any).lockMovementY;
      const nextLeft = (activeObject.left ?? 0) + (lockedX ? 0 : deltaX);
      const nextTop = (activeObject.top ?? 0) + (lockedY ? 0 : deltaY);

      activeObject.set({
        left: nextLeft,
        top: nextTop,
      });
      activeObject.setCoords();
      canvas.requestRenderAll();
      syncCanvasToStore(canvas);
      requestLayerSync();
      saveState();
      const afterGeometry = getCanvasGeometrySnapshot();
      if (isActiveSelection(activeObject)) {
        reportCommittedCanvasPageGeometry(beforeGeometry, afterGeometry);
      } else {
        const objectId = (activeObject as any).id;
        if (typeof objectId === 'string') {
          reportCommittedCanvasGeometry(
            objectId,
            beforeGeometry.find((item) => item.id === objectId)?.value,
          );
        }
      }
      return;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
};
